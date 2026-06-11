const STATS = [
  { value: "×12", valueClass: "text-paper", caption: "平均内容产出速度" },
  { value: "7+", valueClass: "text-sun", caption: "已覆盖中文内容平台" },
  { value: "-85%", valueClass: "text-paper", caption: "单篇内容创作成本" },
];

/** Klein-blue stats band with three Archivo Black numerals. */
export function StatsBand() {
  return (
    <section className="border-t-2 border-ink bg-klein">
      <div className="mx-auto grid max-w-[1400px] gap-6 p-12 text-center sm:grid-cols-3">
        {STATS.map((stat) => (
          <div key={stat.caption}>
            <div className={`font-archivo text-[52px] leading-[1.2] ${stat.valueClass}`}>
              {stat.value}
            </div>
            <div className="mt-1 text-[15px] text-mist">{stat.caption}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
