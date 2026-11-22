import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { renderMarkdown } from "@/lib/services/report-markdown";
import { activityReport } from "@/lib/services/reports";

import { readReportInput } from "../report-input";

export const dynamic = "force-dynamic";

/**
 * The report as markdown, for the copy button and the preview.
 *
 * It used to travel inside the page twice -- as the copy button's prop and as
 * the rendered preview -- which for a busy week was most of a 440 KB page,
 * for a button most visits never press. Now it is fetched when it is wanted.
 */
export async function GET(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const input = await readReportInput(user.id, {
    period: url.searchParams.get("period"),
    project: url.searchParams.get("project"),
  });
  if (!input) return new Response("Not found", { status: 404 });

  const { t } = await getT();
  const report = await activityReport(user.id, input.window, { projectId: input.projectId });
  return new Response(renderMarkdown(report, t), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
