// HR Settings tab: benefit plan catalogue (same editor as Benefits → Plans).
import MasterDataEditor from "@/hr/components/MasterDataEditor";
import { Card, Loading } from "@/hr/ui";
import { useOrg } from "@/lib/hr/org";
import { benefitPlanConfig } from "@/hr/pages/BenefitsPage";

export default function BenefitPlansSettings({ canEdit }) {
  const org = useOrg();
  if (org.loading && !org.data) return <Loading />;
  return <Card><MasterDataEditor config={benefitPlanConfig(org.data?.employmentTypes)} canEdit={canEdit} /></Card>;
}
