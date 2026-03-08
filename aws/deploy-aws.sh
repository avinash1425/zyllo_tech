#!/usr/bin/env bash
# =============================================================================
# ArthaAI — Full AWS Backend Deployment Script
# Run this inside AWS CloudShell (ap-south-2 region already selected)
# Usage: chmod +x deploy-aws.sh && ./deploy-aws.sh sk-ant-api...YOUR_KEY_HERE...
# =============================================================================
set -e

REGION="ap-south-2"
SES_REGION="ap-south-1"   # SES is only available in Mumbai
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ANTHROPIC_API_KEY="${1:-}"

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "❌  Usage: ./deploy-aws.sh sk-ant-api...YOUR_KEY_HERE..."
  echo "    Get your key from: https://console.anthropic.com/settings/keys"
  exit 1
fi

echo "======================================================"
echo " ArthaAI AWS Deployment  |  Account: $ACCOUNT_ID"
echo " Region: $REGION  |  SES Region: $SES_REGION"
echo "======================================================"

# -----------------------------------------------------------------
# 1. Update arthaai-chat: timeout, memory, and Anthropic API key
# -----------------------------------------------------------------
echo ""
echo "▶  [1/7] Updating arthaai-chat configuration..."
aws lambda update-function-configuration \
  --function-name arthaai-chat \
  --timeout 30 \
  --memory-size 256 \
  --environment "Variables={ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY}" \
  --region $REGION \
  --no-cli-pager \
  --query '{Timeout:Timeout,MemorySize:MemorySize}' 2>&1
echo "✅  arthaai-chat config updated."

# -----------------------------------------------------------------
# 2. Create API Gateway HTTP API for arthaai-chat
# -----------------------------------------------------------------
echo ""
echo "▶  [2/7] Creating API Gateway HTTP API..."
API_ID=$(aws apigatewayv2 create-api \
  --name arthaai-api \
  --protocol-type HTTP \
  --cors-configuration AllowOrigins='["*"]',AllowMethods='["POST","OPTIONS"]',AllowHeaders='["Content-Type","Authorization","x-api-key"]' \
  --region $REGION \
  --no-cli-pager \
  --query 'ApiId' --output text)
echo "✅  API Gateway created: $API_ID"

# -----------------------------------------------------------------
# 3. Create Lambda integration for arthaai-chat
# -----------------------------------------------------------------
echo ""
echo "▶  [3/7] Creating Lambda integration..."
LAMBDA_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:arthaai-chat"

INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id $API_ID \
  --integration-type AWS_PROXY \
  --integration-uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${LAMBDA_ARN}/invocations" \
  --payload-format-version 2.0 \
  --region $REGION \
  --no-cli-pager \
  --query 'IntegrationId' --output text)
echo "✅  Integration created: $INTEGRATION_ID"

# -----------------------------------------------------------------
# 4. Create route POST /chat
# -----------------------------------------------------------------
echo ""
echo "▶  [4/7] Creating POST /chat route..."
aws apigatewayv2 create-route \
  --api-id $API_ID \
  --route-key "POST /chat" \
  --target "integrations/$INTEGRATION_ID" \
  --region $REGION \
  --no-cli-pager > /dev/null

# -----------------------------------------------------------------
# 5. Deploy to $default stage
# -----------------------------------------------------------------
echo ""
echo "▶  [5/7] Deploying API Gateway stage..."
aws apigatewayv2 create-stage \
  --api-id $API_ID \
  --stage-name '$default' \
  --auto-deploy \
  --region $REGION \
  --no-cli-pager > /dev/null

# -----------------------------------------------------------------
# 6. Grant API Gateway permission to invoke the Lambda
# -----------------------------------------------------------------
echo ""
echo "▶  [6/7] Granting API Gateway permission to invoke Lambda..."
aws lambda add-permission \
  --function-name arthaai-chat \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*" \
  --region $REGION \
  --no-cli-pager > /dev/null
echo "✅  Permission granted."

API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/chat"
echo ""
echo "🌐  arthaai-chat API endpoint: $API_URL"

# -----------------------------------------------------------------
# 7. Create arthaai-notify Lambda
# -----------------------------------------------------------------
echo ""
echo "▶  [7/7] Creating arthaai-notify Lambda..."

# Check if arthaai-notify already exists
if aws lambda get-function --function-name arthaai-notify --region $REGION --no-cli-pager > /dev/null 2>&1; then
  echo "   arthaai-notify already exists — updating code..."
  cd ~/arthaai-notify 2>/dev/null || mkdir -p ~/arthaai-notify && cd ~/arthaai-notify
else
  mkdir -p ~/arthaai-notify && cd ~/arthaai-notify
fi

# Write the Lambda code
cat > index.js << 'LAMBDAEOF'
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const ses = new SESClient({ region: "ap-south-1" });
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "info@zyllotech.com";
const FROM_EMAIL  = process.env.FROM_EMAIL  || "notifications@zyllotech.com";
exports.handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method || "POST";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  try {
    const { type, data } = JSON.parse(event.body || "{}");
    let subject = "", bodyText = "";
    switch (type) {
      case "contact":
        subject = `New Contact Inquiry from ${data.name}`;
        bodyText = `Name: ${data.name}\nEmail: ${data.email}\nPhone: ${data.phone||"N/A"}\nSubject: ${data.subject}\nService: ${data.service||"N/A"}\n\nMessage:\n${data.message}`;
        break;
      case "career":
        subject = `New Career Application: ${data.role} — ${data.fullName}`;
        bodyText = `Name: ${data.fullName}\nEmail: ${data.email}\nPhone: ${data.phone}\nRole: ${data.role}\nLocation: ${data.location}\nExperience: ${data.experience}\nLinkedIn: ${data.linkedIn||"N/A"}\n\nCover Letter:\n${data.coverLetter}`;
        break;
      case "newsletter":
        subject = `New Newsletter Subscriber: ${data.email}`;
        bodyText = `New subscriber: ${data.email}`;
        break;
      default:
        throw new Error(`Unknown type: ${type}`);
    }
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [ADMIN_EMAIL] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Text: { Data: bodyText, Charset: "UTF-8" } },
      },
    }));
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
LAMBDAEOF

# Install @aws-sdk/client-ses
npm install @aws-sdk/client-ses --save 2>/dev/null
zip -r ../arthaai-notify.zip . > /dev/null

cd ~

# Get the existing role ARN from arthaai-chat, create a new one for notify
ROLE_ARN=$(aws lambda get-function-configuration \
  --function-name arthaai-chat \
  --region $REGION \
  --no-cli-pager \
  --query 'Role' --output text)

# Create the Lambda function
NOTIFY_ARN=$(aws lambda create-function \
  --function-name arthaai-notify \
  --runtime nodejs22.x \
  --role $ROLE_ARN \
  --handler index.handler \
  --zip-file fileb://arthaai-notify.zip \
  --timeout 15 \
  --memory-size 128 \
  --region $REGION \
  --no-cli-pager \
  --query 'FunctionArn' --output text 2>&1 || \
  aws lambda update-function-code \
    --function-name arthaai-notify \
    --zip-file fileb://arthaai-notify.zip \
    --region $REGION \
    --no-cli-pager \
    --query 'FunctionArn' --output text)

echo "✅  arthaai-notify Lambda ARN: $NOTIFY_ARN"

# Attach SES policy to the role
ROLE_NAME=$(echo $ROLE_ARN | cut -d'/' -f2)
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/AmazonSESFullAccess \
  --no-cli-pager 2>/dev/null || true
echo "✅  SES permissions attached."

# =============================================================================
echo ""
echo "======================================================"
echo "  ✅  DEPLOYMENT COMPLETE!"
echo "======================================================"
echo ""
echo "  arthaai-chat API URL:"
echo "  $API_URL"
echo ""
echo "  Now update guru.html line ~1148 with this URL:"
echo "  Replace:  SUPABASE_URL/functions/v1/arthaai-chat"
echo "  With:     $API_URL"
echo ""
echo "  Verify by visiting:"
echo "  curl -X POST $API_URL -H 'Content-Type: application/json' \\"
echo "    -d '{\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}'"
echo "======================================================"
