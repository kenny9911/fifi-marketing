import type { Platform } from "@/lib/types";

/** Placeholder card for platforms without a full canned demo result. */
export function OtherCard({ platform }: { platform: Platform }) {
  return (
    <div className="rounded-[18px] bg-paper p-7 text-center">
      <div className="text-base font-black">
        {platform.name} · {platform.expert.name} 的内容已生成
      </div>
      <div className="mt-2 text-[13.5px] leading-[1.8] text-stone">
        此 Demo 预置了小红书 / 抖音 / 公众号的完整示例
        <br />
        其余平台在正式版中同样会输出完整稿件
      </div>
    </div>
  );
}
