import type { Metadata } from "next";
import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";

export const metadata: Metadata = {
  title: "灰灰创作台 · 灰灰营销 FiFi",
  description:
    "AI 创作工作台：一份简报开稿，专家流水线实时思考，七大平台定稿与微调。",
};

/**
 * The studio workbench. Reads `?task=<id>` (deep link from the usage
 * dashboard's 打开 action) and lets the shell open that task on mount.
 */
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const task = typeof sp.task === "string" && sp.task ? sp.task : undefined;
  return <WorkbenchShell initialTaskId={task} />;
}
