import type { Metadata } from "next"
import { NotFoundState } from "@/components/prototype/not-found-state"
import { messages } from "@/lib/i18n"

export const metadata: Metadata = { title: messages.notFound.app.metaTitle }

const t = messages.notFound.app

/**
 * 全站 404。未匹配的 URL（例如 /crm/whatever 这类已经删掉的样例路由）由这里兜底，
 * 永远给出真实可用的下一步，避免死胡同。
 */
export default function AppNotFound() {
  return (
    <main className="relative flex flex-1 items-center justify-center px-gutter py-16">
      <div className="w-full max-w-content">
        {/* 404 不属于任何产品页面：唯一的主行动是回到 S1 首页。
            这一页同时是 QA 的「中性路由」——它不 opt-in 任何性格层，
            所以它必须仍然是有样式的、可读的（见 tests/core-neutrality.spec.ts）。 */}
        <NotFoundState
          code="404"
          testId="app-not-found"
          title={t.title}
          description={t.description}
          action={{ label: t.action, href: "/" }}
        />
      </div>
    </main>
  )
}
