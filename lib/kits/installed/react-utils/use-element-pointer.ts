"use client";

/**
 * 指针追踪 —— InteractiveHero / SpotlightSurface / DataCursor 共用。
 *
 * 设计要点：
 *   1. **rAF 合并**：pointermove 只做记录，真正的 DOM 写入在下一帧统一发生。
 *      高频 pointermove 直接写 style 会造成每帧多次样式重算。
 *   2. **只写 CSS 变量**：组件不直接写 transform/left/top，
 *      而是写 `--kits-px` / `--kits-py`，由 pack 的 CSS 决定怎么用。
 *      → 换 Style Pack 时指针效果的"幅度"自动改变，组件零改动。
 *   3. **能力降级**：粗指针（触屏）先返回 `enabled=false`，不注册任何监听。
 *   4. **离开即归零**：pointerleave 把变量复位，避免指针对效卡在边缘。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFinePointer, useMotionAllowed } from "./env";

export interface ElementPointerOptions {
  /** 产品级关闭开关（来自 MotionFallbackProps） */
  disableMotion?: boolean;
  /** 是否把坐标归一化到 [-1, 1]（适合视差）；false 时是 [0, 1]（适合光斑定位） */
  normalized?: boolean;
  /**
   * 未追踪指针时写入的静止坐标（指针能力之外的降级位置）。
   * 视差用居中 `[0, 0]`；光斑用左上 `[0, 0]`（即归一化的 0% / 0%）。
   */
  restValue?: { x: number; y: number };
}

export interface ElementPointer {
  /** 挂到目标元素上的 ref */
  ref: React.RefObject<HTMLElement | null>;
  /** 指针是否真正在驱动效果（触屏 / reduced-motion / disableMotion 下为 false） */
  enabled: boolean;
  /** 指针是否当前位于元素内 */
  active: boolean;
}

export function useElementPointer({
  disableMotion = false,
  normalized = true,
  restValue,
}: ElementPointerOptions = {}): ElementPointer {
  const ref = useRef<HTMLElement | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const motionAllowed = useMotionAllowed(disableMotion);
  const finePointer = useFinePointer();
  const [active, setActive] = useState(false);

  const enabled = motionAllowed && finePointer;

  // 对象身份必须稳定：useCallback/useEffect 的依赖里有它，
  // 否则每次 render 都会重挂监听。同样用对象字面量做默认值也会踩这个坑。
  const fallbackX = restValue?.x ?? 0;
  const fallbackY = restValue?.y ?? 0;
  const rest = useMemo(
    () => ({ x: fallbackX, y: fallbackY }),
    [fallbackX, fallbackY],
  );

  const flush = useCallback(() => {
    frame.current = null;
    const element = ref.current;
    const point = pending.current ?? rest;
    if (!element) return;
    element.style.setProperty("--kits-px", point.x.toFixed(4));
    element.style.setProperty("--kits-py", point.y.toFixed(4));
  }, [rest]);

  // 能力变化（进入/退出 reduced-motion、插上鼠标、产品关闭动效）时同步静止值。
  // 这条 effect 让「降级」不只是不注册监听，而是把变量真正复位到静止位置。
  useEffect(() => {
    if (enabled) return;
    pending.current = null;
    flush();
  }, [enabled, flush]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const ratioX = (event.clientX - rect.left) / rect.width;
      const ratioY = (event.clientY - rect.top) / rect.height;
      pending.current = normalized
        ? { x: ratioX * 2 - 1, y: ratioY * 2 - 1 }
        : { x: ratioX, y: ratioY };
      if (frame.current === null) {
        frame.current = requestAnimationFrame(flush);
      }
    };

    const onEnter = () => setActive(true);
    const onLeave = () => {
      setActive(false);
      pending.current = rest;
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    };

    element.addEventListener("pointermove", onMove, { passive: true });
    element.addEventListener("pointerenter", onEnter, { passive: true });
    element.addEventListener("pointerleave", onLeave, { passive: true });

    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerenter", onEnter);
      element.removeEventListener("pointerleave", onLeave);
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, [enabled, flush, normalized, rest]);

  return { ref, enabled, active };
}
