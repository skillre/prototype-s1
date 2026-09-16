import { zhCN, type Messages } from "./zh-CN"

/**
 * Locale registry — the only place that knows which dictionaries exist.
 *
 * Default is `zh-CN`. Adding `en-US` is a two-line change: create
 * `lib/i18n/en-US.ts` exporting a `Messages`-shaped object, then append the tag
 * to `LOCALES` and the map below. No component needs to know.
 *
 * ## 覆盖范围（重要：把「界面文案」和「业务内容」分开）
 *
 * 词典负责 **界面文案**，以及由界面生成的文案模板：
 *   ✅ components/**        所有共享 UI（含 Sidebar / TopNav / FilterBar /
 *                           Pagination / DetailDrawer 等组件的默认文案）
 *   ✅ app/**               全部路由：CRM（/crm/**）、内置演示（/demo/**）、
 *                           落地页（/）、404 页
 *   ✅ lib/ai-summary.ts    AI 摘要的生成模板（是文案，不是数据）
 *
 * 词典**不**负责 **业务记录内容**——那是数据，不是可翻译的文案：
 *   ⛔ lib/crm-data.ts      CRM 的客户名、公司名、备注、活动标题、标签、金额
 *   ⛔ lib/mock-data.ts     演示工作区的账户、活动流、通知
 *
 * 因此 `app/**` 与 `components/**` 里不应再出现任何用户可见的字面文案；
 * 新增原型直接从词典取文案即可。
 */
export const LOCALES = ["zh-CN"] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "zh-CN"

const dictionaries: Record<Locale, Messages> = {
  "zh-CN": zhCN,
}

/** Messages for a locale, falling back to the default for anything unknown. */
export function getMessages(locale: Locale = DEFAULT_LOCALE): Messages {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE]
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/** Non-hook accessor for server components and non-React modules. */
export const messages = getMessages(DEFAULT_LOCALE)

export { zhCN }
export type { Messages }
