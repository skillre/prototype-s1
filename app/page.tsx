import { messages } from "@/lib/i18n"

/**
 * S1 工作台 · 首屏（初始化边界阶段）。
 *
 * 这一页是**诚实的首屏**，不是产品能力的展示：
 *
 *   • 它说明这是什么产品（16:9 单屏不加滚动的 SOC 控制台）、现在的边界在哪里、
 *     下一步是什么；
 *   • 它**不**假装已经实现了任何组件 —— 十二个组件一个都还没做，
 *     所以这里只列「本轮已完成 / 尚未开始」，并且把「形态规格」明确标成目标而不是现状；
 *   • 它是 Server Component：没有入场动画、没有环境光、没有装饰性动效。
 *     产品的动效语言是 event-driven（只为状态变化服务），而首页没有状态变化。
 *
 * 视觉构成取自设计稿实测的骨架气质：顶部一条读数指挥条，主体两列靠 1px 规则线分栏，
 * 读数与命令一律等宽，信息密度高，层级靠规则线与字重——不靠卡片边框、不靠渐变、不靠辉光。
 *
 * 颜色不是写在这一页里的，也不是"只有中性层"：这一页只用语义槽位
 * （`--foreground` / `--surface` / `--hairline` / `--brand` / `--danger` …），
 * 而 `lib/kits/adapters/s1-tokens.css` 把这些槽位绑定到 Kits `console` pack 的 `--kits-*`。
 * 所以**深色主题下的取值就是 pack 的取值**（画布 `#0b1220`、规则线 `#4A6C9B` …）。
 * pack 只在深色主题接入（见那个适配层的说明），浅色主题仍是 Factory 中性层。
 * 产品代码里没有任何颜色字面量，换 pack 时改的只有适配层一行。
 */
export default function HomePage() {
  const brand = messages.brand
  const t = messages.landing

  const reads = [
    { label: t.strip.stageLabel, value: t.strip.stageValue, note: t.strip.stageNote },
    { label: t.strip.specLabel, value: t.strip.specValue, note: t.strip.specNote },
    { label: t.strip.visualLabel, value: t.strip.visualValue, note: t.strip.visualNote },
  ]

  return (
    /* 注意：这里**没有** data-factory-landing —— 那是 Factory 自己落地页的标记，
       派生为产品之后必须消失（scripts/verify-init.mjs 检查）。 */
    <main className="flex flex-1 flex-col">
      {/* ① 指挥条：身份 + 阶段读数。 */}
      <header className="border-b border-hairline bg-surface/40">
        <div className="mx-auto flex w-full max-w-content flex-wrap items-center gap-x-10 gap-y-4 px-gutter py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-field border border-hairline font-mono text-label font-semibold tracking-tight text-brand">
              {brand.mark}
            </span>
            <span className="flex flex-col">
              <span className="text-body font-semibold leading-tight">{brand.name}</span>
              <span className="text-label leading-tight text-muted-foreground">
                {brand.subtitle}
              </span>
            </span>
          </div>

          <dl className="ml-auto flex flex-wrap items-stretch gap-x-8 gap-y-3">
            {reads.map((read) => (
              <div key={read.label} className="flex flex-col gap-0.5 border-l border-hairline pl-4">
                <dt className="eyebrow text-muted-foreground">{read.label}</dt>
                <dd className="numeric font-mono text-body font-semibold text-foreground">
                  {read.value}
                </dd>
                <dd className="text-label text-muted-foreground">{read.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      {/* 主体：左列说清楚「是什么 / 到哪一步」，右列是规格、边界与命令。 */}
      <div className="mx-auto grid w-full max-w-content flex-1 gap-x-10 gap-y-10 px-gutter py-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-stack">
          <section className="flex flex-col gap-3">
            <p className="eyebrow text-brand">{t.eyebrow}</p>
            <h1 className="text-title text-foreground">{t.title}</h1>
            <p className="max-w-text text-body leading-relaxed text-muted-foreground">
              {t.description}
            </p>
            <p className="font-mono text-caption text-muted-foreground">{t.done.caption}</p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-heading text-foreground">{t.done.title}</h2>
            <ul className="flex flex-col">
              {t.done.items.map((item) => (
                <li
                  key={item}
                  className="border-t border-hairline py-3 pl-5 text-body-sm leading-relaxed text-muted-foreground first:border-t-0 first:pt-0"
                >
                  <span aria-hidden className="mr-2 font-mono text-success">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-heading text-foreground">{t.pending.title}</h2>
            <p className="text-label text-muted-foreground">{t.pending.caption}</p>
            <ul className="flex flex-col">
              {t.pending.items.map((item) => (
                <li
                  key={item}
                  className="border-t border-hairline py-3 pl-5 text-body-sm leading-relaxed text-muted-foreground first:border-t-0 first:pt-0"
                >
                  <span aria-hidden className="mr-2 font-mono text-warning">
                    ·
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-stack lg:border-l lg:border-hairline lg:pl-10">
          <section className="flex flex-col gap-3">
            <h2 className="text-heading text-foreground">{t.spec.title}</h2>
            <p className="text-label text-muted-foreground">{t.spec.caption}</p>
            <dl className="flex flex-col">
              {t.spec.features.map((feature, index) => (
                <div
                  key={feature.title}
                  className="border-t border-hairline py-3 first:border-t-0 first:pt-0"
                >
                  <dt className="flex items-baseline gap-2">
                    <span className="font-mono text-label text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-body-sm font-semibold text-foreground">
                      {feature.title}
                    </span>
                  </dt>
                  <dd className="mt-1 text-caption leading-relaxed text-muted-foreground">
                    {feature.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-heading text-foreground">{t.boundary.title}</h2>
            <ul className="flex flex-col">
              {t.boundary.items.map((item) => (
                <li
                  key={item}
                  className="border-t border-hairline py-2.5 text-caption leading-relaxed text-muted-foreground first:border-t-0 first:pt-0"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-heading text-foreground">{t.commands.title}</h2>
            {/* 命令放在 <code> 里：它是代码，不是界面文案。 */}
            <div className="flex flex-col gap-1.5 border-l-2 border-brand/40 pl-4">
              {t.commands.items.map((command) => (
                <code key={command} className="font-mono text-label text-muted-foreground">
                  {command}
                </code>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <footer className="border-t border-hairline py-5">
        <p className="mx-auto w-full max-w-content px-gutter text-label text-muted-foreground">
          {t.footer}
        </p>
      </footer>
    </main>
  )
}
