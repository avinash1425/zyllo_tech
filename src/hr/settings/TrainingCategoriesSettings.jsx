// HR Settings tab: training categories (courses are managed in Training → Courses).
import MasterDataEditor from "@/hr/components/MasterDataEditor";
import { Card } from "@/hr/ui";
import { trainingCategoryConfig } from "@/hr/pages/TrainingPage";

export default function TrainingCategoriesSettings({ canEdit }) {
  return <Card><MasterDataEditor config={trainingCategoryConfig} canEdit={canEdit} /></Card>;
}
