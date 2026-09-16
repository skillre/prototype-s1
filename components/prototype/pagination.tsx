"use client"

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useMessages } from "@/components/i18n/locale-provider"
import { cn } from "@/lib/utils"

type PaginationProps = {
  page: number
  totalPages: number
  /** 当前页显示区间，例如 "第 1–8 条，共 22 条"。 */
  caption?: string
  onPageChange: (page: number) => void
  className?: string
  testId?: string
  /** 无障碍文案可覆盖，默认取当前语言词典（`t.pagination`）。 */
  labels?: {
    nav?: string
    previous?: string
    next?: string
    page?: (page: number) => string
  }
}

/**
 * 受控分页控件。与 DataTable 搭配使用：调用方负责切片，这里只渲染页码与
 * 上一页/下一页。所有按钮都连到真实回调（无装饰性控件）。
 */
export function Pagination({
  page,
  totalPages,
  caption,
  onPageChange,
  className,
  testId,
  labels,
}: PaginationProps) {
  const t = useMessages()
  const pages = buildPageList(page, totalPages)
  const navLabel = labels?.nav ?? t.pagination.nav
  const previousLabel = labels?.previous ?? t.pagination.previous
  const nextLabel = labels?.next ?? t.pagination.next
  const pageLabel = labels?.page ?? t.pagination.page

  return (
    <nav
      aria-label={navLabel}
      data-testid={testId}
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      <span className="numeric text-caption text-muted-foreground">{caption}</span>

      <div className="flex items-center gap-1 rounded-field bg-surface/70 p-0.5 ring-1 ring-border/60 shadow-subtle">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={previousLabel}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon />
        </Button>

        {pages.map((entry, index) =>
          entry === "gap" ? (
            <span
              key={`gap-${index}`}
              aria-hidden
              className="px-1 text-caption text-muted-foreground"
            >
              …
            </span>
          ) : (
            <Button
              key={entry}
              type="button"
              variant={entry === page ? "default" : "ghost"}
              size="icon-sm"
              aria-label={pageLabel(entry)}
              aria-current={entry === page ? "page" : undefined}
              onClick={() => onPageChange(entry)}
              className={cn(
                "numeric",
                entry !== page && "text-muted-foreground hover:text-foreground"
              )}
            >
              {entry}
            </Button>
          )
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={nextLabel}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  )
}

/** 最多显示 5 个页码，两端各保留一页，其余折叠为 gap。 */
function buildPageList(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)

  const result: (number | "gap")[] = []
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) result.push("gap")
    result.push(value)
  })
  return result
}
