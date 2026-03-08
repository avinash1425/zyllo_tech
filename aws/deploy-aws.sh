#!/usr/bin/env bash
# =============================================================================
# ArthaAI — Full AWS Backend Deployment Script
# Run this inside AWS CloudShell (ap-south-2 region already selected)
#
# Usage:
#   chmod +x deploy-aws.sh
#   ./deploy-aws.sh YOUR_GEMINI_API_KEY
#
# Get your FREE Gemini API key (no credit card): https://aistudio.google.com/app/apikey
# =============================================================================
set -e

REGION="ap-south-2"
SES_REGION="ap-south-1"   # SES is only available in Mumbai
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
GEMINI_API_KEY="${1:-}"

if [ -z "$GEMINI_API_KEY" ]; then
  echo "❌  Usage: ./deploy-aws.sh YOUR_GEMINI_API_KEY"
  echo "    Get your FREE key (no credit card): https://aistudio.google.com/app/apikey"
  exit 1
fi

echo "======================================================"
echo " ArthaAI AWS Deployment  |  Account: $ACCOUNT_ID"
echo " Region: $REGION  |  SES Region: $SES_REGION"
echo " AI Engine: Google Gemini 1.5 Flash (Free)"
echo "======================================================"

# -----------------------------------------------------------------
# 1. Re-package and upload arthaai-chat Lambda with Gemini code
# -----------------------------------------------------------------
echo ""
echo "▶  [1/8] Packaging arthaai-chat Lambda (Gemini)..."

mkdir -p ~/arthaai-chat && cd ~/arthaai-chat

cat > index.js << 'CHATEOF'
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const SYSTEM_PROMPT = `You are ArthaGuru, a friendly and knowledgeable AI financial advisor specialising in Indian personal finance. You provide warm, practical guidance on budgeting, SIP, mutual funds, ELSS, PPF, NPS, tax planning (80C, 80D, HRA), emergency funds, debt management, goal planning (home, education, retirement), stock market basics (NSE/BSE), index funds, risk management, and insurance. Always give advice in INR and Indian context. Keep responses concise (under 300 words). Recommend consulting a SEBI-registered advisor for large decisions. You are part of the ArthaAI platform by Zyllotech.`;
exports.handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method || "POST";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
    const { messages = [] } = JSON.parse(event.body || "{}");
    if (!messages.length) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "messages required" }) };
    const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents, generationConfig: { temperature: 0.7, maxOutputTokens: 1024 } }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const message = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, please try again.";
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ message }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
CHATEOF

zip function.zip index.js > /dev/null
echo "✅  Lambda packaged."

# Deploy new code
aws lambda update-function-code \
  --function-name arthaai-chat \
  --zip-file fileb://function.zip \
  --region $REGION \
  --no-cli-pager \
  --query 'CodeSize' --output text > /dev/null

# -----------------------------------------------------------------
# 2. Update arthaai-chat: timeout, memory, Gemini API key
# -----------------------------------------------------------------
echo ""
echo "▶  [2/8] Updating arthaai-chat config + API key..."
aws lambda update-function-configuration \
  --function-name arthaai-chat \
  --timeout 30 \
  --memory-size 256 \
  --environment "Variables={GEMINI_API_KEY=$GEMINI_API_KEY}" \
  --region $REGION \
  --no-cli-pager \
  --query '{Timeout:Timeout,MemorySize:MemorySize}'
echo "✅  arthaai-chat config updated."

cd ~

# -----------------------------------------------------------------
# 3. Create API Gateway HTTP API for arthaai-chat
# -----------------------------------------------------------------
echo ""
echo "▶  [3/8] Creating API Gateway HTTP API..."
API_ID=$(aws apigatewayv2 create-api \
  --name arthaai-api \
  --protocol-type HTTP \
  --cors-configuration "AllowOrigins=*,AllowMethods=POST OPTIONS,AllowHeaders=Content-Type Authorization" \
  --region $REGION \
  --no-cli-pager \
  --query 'ApiId' --output text)
echo "✅  API Gateway created: $API_ID"

# -----------------------------------------------------------------
# 4. Create Lambda integration
# -----------------------------------------------------------------
echo ""
echo "▶  [4/8] Creating Lambda integration..."
LAMBDA_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:arthaai-chat"
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id $API_ID \
  --integration-type AWS_PROXY \
  --integration-uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${LAMBDA_ARN}/invocations" \
  --payload-format-version 2.0 \
  --region $REGION \
  --no-cli-pager \
  --query 'IntegrationId' --output text)
echo "✅  Integration: $INTEGRATION_ID"

# -----------------------------------------------------------------
# 5. Create POST /chat route + default stage
# -----------------------------------------------------------------
echo ""
echo "▶  [5/8] Creating route + stage..."
aws apigatewayv2 create-route \
  --api-id $API_ID \
  --route-key "POST /chat" \
  --target "integrations/$INTEGRATION_ID" \
  --region $REGION \
  --no-cli-pager > /dev/null

aws apigatewayv2 create-stage \
  --api-id $API_ID \
  --stage-name '$default' \
  --auto-deploy \
  --region $REGION \
  --no-cli-pager > /dev/null
echo "✅  Route and stage ready."

# -----------------------------------------------------------------
# 6. Grant API Gateway permission to invoke Lambda
# -----------------------------------------------------------------
echo ""
echo "▶  [6/8] Granting invoke permission..."
aws lambda add-permission \
  --function-name arthaai-chat \
  --statement-id apigateway-arthaai-$(date +%s) \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*" \
  --region $REGION \
  --no-cli-pager > /dev/null
echo "✅  Permission granted."

API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/chat"

# -----------------------------------------------------------------
# 7. Create arthaai-notify Lambda
# -----------------------------------------------------------------
echo ""
echo "▶  [7/8] Creating arthaai-notify Lambda..."
mkdir -p ~/arthaai-notify && cd ~/arthaai-notify

cat > index.js << 'NOTIFYEOF'
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const ses = new SESClient({ region: "ap-south-1" });
const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "info@zyllotech.com";
const FROM_EMAIL  = process.env.FROM_EMAIL  || "notifications@zyllotech.com";
exports.handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method || "POST";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  try {
    const { type, data } = JSON.parse(event.body || "{}");
    let subject = "", bodyText = "";
    if (type === "contact") { subject = `New Contact: ${data.name}`; bodyText = `Name: ${data.name}\nEmail: ${data.email}\nMessage: ${data.message}`; }
    else if (type === "career") { subject = `Career Application: ${data.role} — ${data.fullName}`; bodyText = `Name: ${data.fullName}\nEmail: ${data.email}\nRole: ${data.role}`; }
    else if (type === "newsletter") { subject = `New Subscriber: ${data.email}`; bodyText = `Subscriber: ${data.email}`; }
    else throw new Error(`Unknown type: ${type}`);
    await ses.send(new SendEmailCommand({ Source: FROM_EMAIL, Destination: { ToAddresses: [ADMIN_EMAIL] }, Message: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: bodyText, Charset: "UTF-8" } } } }));
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
NOTIFYEOF

npm install @aws-sdk/client-ses --save 2>/dev/null
zip -r ../arthaai-notify.zip . > /dev/null
cd ~

ROLE_ARN=$(aws lambda get-function-configuration \
  --function-name arthaai-chat \
  --region $REGION \
  --no-cli-pager \
  --query 'Role' --output text)

NOTIFY_ARN=$(aws lambda create-function \
  --function-name arthaai-notify \
  --runtime nodejs22.x \
  --role $ROLE_ARN \
  --handler index.handler \
  --zip-file fileb://arthaai-notify.zip \
  --timeout 15 \
  --memory-size 128 \
  --environment "Variables={ADMIN_EMAIL=info@zyllotech.com,FROM_EMAIL=notifications@zyllotech.com}" \
  --region $REGION \
  --no-cli-pager \
  --query 'FunctionArn' --output text 2>&1 || \
  aws lambda update-function-code \
    --function-name arthaai-notify \
    --zip-file fileb://arthaai-notify.zip \
    --region $REGION \
    --no-cli-pager \
    --query 'FunctionArn' --output text)
echo "✅  arthaai-notify: $NOTIFY_ARN"

# -----------------------------------------------------------------
# 8. Attach SES policy to Lambda role
# -----------------------------------------------------------------
echo ""
echo "▶  [8/8] Attaching SES permissions..."
ROLE_NAME=$(echo $ROLE_ARN | cut -d'/' -f2)
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/AmazonSESFullAccess \
  --no-cli-pager 2>/dev/null || true
echo "✅  SES permissions attached."

# =============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   ✅  ARTHAAI DEPLOYMENT COMPLETE!                   ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  🌐  arthaai-chat API URL:"
echo "      $API_URL"
echo ""
echo "  📋  NEXT STEP — update guru.html line ~1148:"
echo "      Change: ARTHAGURU_API_URL = 'REPLACE_WITH_API_GATEWAY_URL'"
echo "      To:     ARTHAGURU_API_URL = '$API_URL'"
echo ""
echo "  🧪  Test the endpoint:"
echo "      curl -X POST $API_URL \\"
echo "        -H 'Content-Type: application/json' \\"
echo "        -d '{\"messages\":[{\"role\":\"user\",\"content\":\"Hello ArthaGuru!\"}]}'"
echo ""
echo "  📧  Note: SES email needs domain verification."
echo "      Verify info@zyllotech.com in SES (Mumbai) at:"
echo "      https://ap-south-1.console.aws.amazon.com/ses/home"
echo "══════════════════════════════════════════════════════"
