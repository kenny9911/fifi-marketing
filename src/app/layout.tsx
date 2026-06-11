import type { Metadata } from "next";
import {
  Archivo_Black,
  Noto_Sans_SC,
  Space_Grotesk,
  ZCOOL_QingKe_HuangYou,
} from "next/font/google";
import "./globals.css";

const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  display: "swap",
});

const zcoolHuangYou = ZCOOL_QingKe_HuangYou({
  variable: "--font-zcool-huangyou",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  weight: ["500", "700"],
  subsets: ["latin"],
  display: "swap",
});

const archivoBlack = Archivo_Black({
  variable: "--font-archivo-black",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "灰灰营销 FiFi — 一句话，承包你的全网内容",
  description:
    "AI 原生内容创作平台：输入目标、受众与素材，灰灰的平台专家 AI 团队为微博、公众号、小红书、抖音、知乎、百家号、CSDN 量身创作内容。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      data-scroll-behavior="smooth"
      className={`${notoSansSC.variable} ${zcoolHuangYou.variable} ${spaceGrotesk.variable} ${archivoBlack.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
