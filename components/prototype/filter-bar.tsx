"use client"

import { RotateCcwIcon, SearchIcon, XIcon } from "lucide-react"
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMessages } from "@/components/i18n/locale-provider"
import { cn } from "@/lib/utils"

type FilterBarProps = {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  /** 筛选控件（下拉、开关等）从这里插入。 */
  children?: React.ReactNode
  /** 右对齐的操作（例如"添加客户"）。 */
  actions?: React.ReactNode
  /** 结果计数，例如"共 22 位客户，当前显示 8 位"。 */
  resultCaption?: string
  hasActiveFilters?: boolean
  onReset?: () => void
  className?: string
  /** Lands on the search input — used by e2e tests. */
  searchTestId?: string
  /** 无障碍标签可覆盖，默认中文文案。 */
  clearSearchLabel?: string
  resetLabel?: string
}

/**
 * Standard filter toolbar: search field on the left, configurable filters,
 * result caption and a reset control that only appears when something is
 * actually filtered.
 *
 * V3: the toolbar is an **open row over a hairline**, not a floating panel.
 * A filter strip is a layer above a table, not a card next to one — removing
 * its container is what lets the table below keep the only surface in the
 * region, and therefore the only thing the eye lands on.
 */
export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  children,
  actions,
  resultCaption,
  hasActiveFilters = false,
  onReset,
  className,
  searchTestId,
  clearSearchLabel,
  resetLabel,
}: FilterBarProps) {
  const t = useMessages()
  const placeholder = searchPlaceholder ?? t.common.searchPlaceholder
  const clearLabel = clearSearchLabel ?? t.common.clearSearch
  const resetText = resetLabel ?? t.common.resetFilters

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-hairline pb-3 sm:flex-row sm:flex-wrap sm:items-center",
        className
      )}
    >
      <InputGroup className="h-8 w-full shadow-none sm:max-w-xs">
        <span className="pl-2.5 text-muted-foreground">
          <SearchIcon className="size-4" />
        </span>
        <InputGroupInput
          data-testid={searchTestId}
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholder}
          className="text-body-sm"
        />
        {searchValue ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={clearLabel}
            onClick={() => onSearchChange("")}
            className="mr-0.5 text-muted-foreground hover:text-foreground"
          >
            <XIcon />
          </Button>
        ) : null}
      </InputGroup>

      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}

      {/* 窄屏时结果计数与操作各占一行，避免中文长文案互相挤压。 */}
      <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        {resultCaption ? (
          <span className="numeric text-caption whitespace-nowrap text-muted-foreground">
            {resultCaption}
          </span>
        ) : null}
        {hasActiveFilters && onReset ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={resetText}
                  onClick={onReset}
                  className="text-muted-foreground hover:text-foreground"
                />
              }
            >
              <RotateCcwIcon />
            </TooltipTrigger>
            <TooltipContent side="bottom">{resetText}</TooltipContent>
          </Tooltip>
        ) : null}
        {actions ? <div className="flex items-center gap-2 sm:ml-auto">{actions}</div> : null}
      </div>
    </div>
  )
}
