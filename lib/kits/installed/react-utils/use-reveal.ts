"use client";

/**
 * 揭示观察器 —— InsightReveal 用的滚动进入检测。
 *
 * 关键取舍：**一个 IntersectionObserver 服务所有实例**。
 * 如果每个 InsightReveal 自己 new 一个 observer，一个 20 段落的报告页
 * 就会有 20 个 observer —— 移动端上这是真实的内存与回调开销。
 *
 * 降级策略（三层，全部内建）：
 *   1. 没有 IntersectionObserver（极老浏览器 / 非浏览器环境）→ 立即标记为可见；
 *   2. 用户要求减少动效 → 立即标记为可见（不做位移动画）；
 *   3. CSS 层：`@media (scripting: none)` 与 `.kits-reveal[data-visible="false"]`
 *      的初始隐藏状态由 CSS 守卫，JS 没跑起来时内容依然可见（见 reveal.css）。
 */

import { useEffect, useRef, useState } from "react";
import { useMotionAllowed } from "./env";

type VisibilityCallback = (visible: boolean) => void;

const registry = new Map<Element, VisibilityCallback>();
const registryOptions = new Map<Element, { once: boolean }>();
let observer: IntersectionObserver | null = null;

function ensureObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const callback = registry.get(entry.target);
        if (!callback) continue;
        callback(entry.isIntersecting);
        if (entry.isIntersecting) {
          const options = registryOptions.get(entry.target);
          // 只揭示一次的默认行为：进入后就不再观察，
          // 避免滚动抖动导致元素反复隐藏/揭示。
          if (options?.once) {
            registry.delete(entry.target);
            observer?.unobserve(entry.target);
          }
        }
      }
    },
    // 提前 12% 触发：让元素在真正进入视口前就开始揭示，避免"看到空白再闪出"
    { rootMargin: "0px 0px -12% 0px", threshold: 0.01 },
  );
  return observer;
}

export interface InsightRevealOptions {
  disableMotion?: boolean;
  /** 只揭示一次（默认 true）。false 时离开视口会复位。 */
  once?: boolean;
}

export function useReveal({
  disableMotion = false,
  once = true,
}: InsightRevealOptions = {}): {
  ref: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  animated: boolean;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const motionAllowed = useMotionAllowed(disableMotion);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // 降级 1 & 2：不观察，直接可见。
    // 契约行为（不是写法失误）：reduced-motion / 无 IntersectionObserver 时
    // 内容必须立即可见，这一次额外渲染正是"降级路径"本身。
    if (!motionAllowed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 契约行为：降级路径必须立即把内容标记为可见
      setVisible(true);
      return;
    }

    const activeObserver = ensureObserver();
    if (!activeObserver) {
      // 同一条降级路径的另一半：浏览器不支持 IntersectionObserver。
      // 这里没有 lint 报错（分支顺序使然），因此不加 disable 指令。
      setVisible(true);
      return;
    }

    registry.set(element, setVisible);
    registryOptions.set(element, { once });
    activeObserver.observe(element);

    return () => {
      registry.delete(element);
      registryOptions.delete(element);
      activeObserver.unobserve(element);
    };
  }, [motionAllowed, once]);

  return { ref, visible, animated: motionAllowed };
}
