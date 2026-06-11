import type { Metadata } from "next";
import { UsageDashboard } from "@/components/usage/UsageDashboard";

export const metadata: Metadata = {
  title: "用量与成本 · 灰灰营销 FiFi",
  description:
    "按任务、按日、按周查看 AI 调用次数、token 用量与成本，并按智能体与模型分摊。",
};

export default function UsagePage() {
  return <UsageDashboard />;
}
