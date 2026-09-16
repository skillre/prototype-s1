import { cn } from "@/lib/utils"

type OpenSectionProps = {
  children: React.ReactNode
  /**
   * `hero` — the page's protagonist region: a stronger off-centre bloom plus a
   * masked grid. `wash` — a quiet tinted region for secondary blocks.
   * `none` — no ambient layer at all.
   */
  ambient?: "none" | "wash" | "hero"
  /**
   * The ambient layer is clipped to the region, so the region needs rounded
   * corners to keep the wash from bleeding past its own bounds. It does NOT
   * get a ring, a border or a shadow — that is the whole point: a region you
   * can see without a container you can point at.
   */
  className?: string
  contentClassName?: string
  as?: "section" | "div"
}

/**
 * 开放式区域。
 *
 * 这是 V3 里替代「又一个 Card」的主要手段：一个靠**留白 + 环境光 + 排版**
 * 立起来的区域，没有边框、没有阴影、没有 hover 抬升。当一块内容需要重量
 * 但不需要 elevation 时，用它；只有当内容真的会浮在别的层之上（对话框、
 * 抽屉、tooltip）时才用 Card。
 */
export function OpenSection({
  children,
  ambient = "none",
  className,
  contentClassName,
  as: Tag = "section",
}: OpenSectionProps) {
  return (
    <Tag className={cn("relative isolate", className)}>
      {ambient !== "none" ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-panel",
            ambient === "hero" ? "bg-[var(--hero-base)]" : "bg-surface/40"
          )}
        >
          <div className={cn("absolute inset-0", ambient === "hero" ? "hero-wash" : "ambient-wash")} />
          {ambient === "hero" ? (
            /* Mask is generous and off-centre so the grid never starts on the
               region's own edge — a grid line coinciding with the boundary
               reads as a seam rather than as texture. */
            <div className="ambient-grid absolute -inset-8 [mask-image:radial-gradient(120%_95%_at_24%_0%,black_18%,transparent_82%)]" />
          ) : null}
        </div>
      ) : null}
      <div className={cn("relative", contentClassName)}>{children}</div>
    </Tag>
  )
}
