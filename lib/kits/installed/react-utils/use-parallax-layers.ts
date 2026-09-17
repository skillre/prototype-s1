"use client";

/**
 * 视差层 —— 把元素内的 `[data-kits-depth]` 子元素转成视差层。
 *
 * 为什么不在 JSX 里给每层写内联 style？
 * 因为「深度」是**样式契约**的一部分，不是渲染逻辑。这里刻意让深度值
 * 只出现在 DOM 的 data 属性上，计算发生在浏览器层，产物是 CSS 变量：
 *
 *   <h1 data-kits-depth="0.15">   →   --kits-layer-dx / --kits-layer-dy
 *
 * 位移公式：
 *   偏移 = 指针归一化坐标 × pointerFactor × 深度 × 视差基准
 *
 * 三个因子各司其职：
 *   - `pointerFactor` 来自 Style Pack（editorial 0.15 / cinematic 1.0 / instrument 0.4）
 *     → 换 pack，视差幅度自动改变，组件零改动；
 *   - `深度` 来自组件的 DOM 结构（标题比背景浅一点，副标题比标题浅一点）；
 *   - `视差基准` 是元素的尺寸（12% 宽度、8% 高度）。
 *
 * 降级：粗指针、reduced-motion、disableMotion 任一命中 → 不注册监听，
 * 且把所有层偏移复位为 0。
 */

import { useCallback, useEffect, useRef } from "react";
import { useFinePointer, useMotionAllowed } from "./env";

const DEPTH_ATTRIBUTE = "data-kits-depth";
const HORIZONTAL_BASE = 0.12;
const VERTICAL_BASE = 0.08;

export function useParallaxLayers(disableMotion = false): {
  ref: React.RefObject<HTMLElement | null>;
  enabled: boolean;
} {
  const ref = useRef<HTMLElement | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const motionAllowed = useMotionAllowed(disableMotion);
  const finePointer = useFinePointer();
  const enabled = motionAllowed && finePointer;

  const apply = useCallback(() => {
    frame.current = null;
    const root = ref.current;
    if (!root) return;
    const { x, y } = pending.current;
    const { width, height } = root.getBoundingClientRect();
    const layers = root.querySelectorAll<HTMLElement>(`[${DEPTH_ATTRIBUTE}]`);
    for (const layer of layers) {
      const depth = Number(layer.dataset.kitsDepth) || 0;
      layer.style.setProperty(
        "--kits-layer-dx",
        (x * depth * width * HORIZONTAL_BASE).toFixed(2),
      );
      layer.style.setProperty(
        "--kits-layer-dy",
        (y * depth * height * VERTICAL_BASE).toFixed(2),
      );
    }
  }, []);

  const reset = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const layers = root.querySelectorAll<HTMLElement>(`[${DEPTH_ATTRIBUTE}]`);
    for (const layer of layers) {
      layer.style.removeProperty("--kits-layer-dx");
      layer.style.removeProperty("--kits-layer-dy");
    }
  }, []);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (!enabled) {
      reset();
      return;
    }

    const onMove = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      // 半幅归一化：元素边缘 = ±1
      pending.current = {
        x: (event.clientX - centerX) / (rect.width / 2),
        y: (event.clientY - centerY) / (rect.height / 2),
      };
      if (frame.current === null) frame.current = requestAnimationFrame(apply);
    };

    const onLeave = () => {
      pending.current = { x: 0, y: 0 };
      if (frame.current === null) frame.current = requestAnimationFrame(apply);
    };

    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, [apply, enabled, reset]);

  return { ref, enabled };
}
