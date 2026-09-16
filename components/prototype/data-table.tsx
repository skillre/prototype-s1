"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export interface TableColumn<T> {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  /** Tailwind alignment + width classes for both header and cell. */
  className?: string
}

type DataTableProps<T> = {
  columns: TableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  emptyState?: React.ReactNode
  loading?: boolean
  skeletonRows?: number
  className?: string
  /** Lands on the <table> element — used by e2e tests. */
  testId?: string
}

/**
 * Minimal, typed data table. Handles loading skeletons and an empty state;
 * row clicks are optional (calls `onRowClick`). Scrolls horizontally on
 * narrow screens instead of collapsing columns.
 *
 * Visual hierarchy: the header is a quiet eyebrow row, body rows carry the
 * data, and the row itself is the target — hover tints it and grows a brand
 * rail on the left. V3 dropped the header's filled band and the container's
 * shadow: a table is already a strong enough shape that it does not need
 * elevation on top of it.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyState,
  loading = false,
  skeletonRows = 6,
  className,
  testId,
}: DataTableProps<T>) {
  return (
    <div
      className={cn(
        "relative overflow-x-auto rounded-panel bg-surface ring-1 ring-border/60",
        className
      )}
    >
      <table data-testid={testId} className="w-full min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border/70 text-muted-foreground">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn("eyebrow px-4 py-2.5 font-medium whitespace-nowrap", column.className)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }).map((_, row) => (
                <tr key={row} className="border-b border-border/50 last:border-0">
                  {columns.map((column) => (
                    <td key={column.key} className={cn("px-4 py-2.5", column.className)}>
                      <Skeleton className="h-4 w-full max-w-28" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => {
                const key = rowKey(row)
                const interactive = Boolean(onRowClick)
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "group/row relative border-b border-hairline transition-colors duration-hover ease-standard last:border-0",
                      interactive &&
                        "cursor-pointer hover:bg-brand-soft/45 focus-within:bg-brand-soft/45 outline-none",
                      "data-[selected=true]:bg-brand-soft/45"
                    )}
                    tabIndex={interactive ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              onRowClick(row)
                            }
                          }
                        : undefined
                    }
                  >
                    {columns.map((column, index) => (
                      <td
                        key={column.key}
                        className={cn(
                          // First cell owns the hover rail so the row reads as one target.
                          "relative px-4 py-2.5 align-middle",
                          index === 0 &&
                            interactive &&
                            "before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:scale-y-0 before:rounded-r-full before:bg-brand before:transition-transform before:duration-hover before:ease-standard group-hover/row:before:scale-y-100",
                          column.className
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                )
              })}
        </tbody>
      </table>
      {!loading && rows.length === 0 && emptyState ? (
        <div className="px-4 py-10">{emptyState}</div>
      ) : null}
    </div>
  )
}
