import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin/AdminConsole";

export const metadata: Metadata = {
  title: "管理控制台 · 灰灰营销 FiFi",
  description: "智能体编队、模型注册表、平台技能库与自进化复盘的统一管理台。",
};

export default function AdminPage() {
  return <AdminConsole />;
}
