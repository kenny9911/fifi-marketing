import type { Metadata } from "next";
import { StudioShell } from "@/components/studio/StudioShell";

export const metadata: Metadata = {
  title: "灰灰创作台 · 灰灰营销 FiFi",
  description: "对话式 AI 创作台：一份简报，七大平台专属专家同步出稿。",
};

export default function StudioPage() {
  return <StudioShell />;
}
