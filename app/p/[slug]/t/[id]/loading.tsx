import { getT } from "@/lib/lang";
import { PageSkeleton } from "@/app/components/page-skeleton";

export default async function Loading() {
  const { t } = await getT();
  return <PageSkeleton label={t("loadingPage")} shape="task" />;
}
