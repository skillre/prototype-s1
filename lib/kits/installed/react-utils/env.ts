/**
 * 环境能力探测 —— 所有组件共用的降级判据。
 *
 * 三条原则：
 *   1. **SSR 安全**：服务端与客户端**首帧**一律返回保守值
 *      （`reduced=false`、`finePointer=false`、`animated=false`），
 *      因此服务端 HTML 与 hydration 首帧逐字节一致 —— 不存在 hydration mismatch。
 *   2. **监听变化**：用户可能在运行中改系统偏好（尤其是 reduced-motion），
 *      组件必须跟着变，而不是只读一次。
 *   3. **组件内建**：产品代码不需要写任何 `matchMedia`，也不需要自己处理降级。
 *
 * 关于 lint：这几个 hook 是"挂载后才探测浏览器能力"的典型场景 ——
 * 首帧必须与 SSR 一致，挂载后必须重新渲染以反映真实能力。
 * 因此 effect 内的 setState 是**契约行为**，而不是写法失误；
 * 每一处都带说明性的 eslint-disable。
 */

import { useEffect, useState } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

function subscribe(
  query: string,
  onChange: (matches: boolean) => void,
): () => void {
  // 浏览器能力探测全部收敛到这一处：其余组件与共享 hook 的源码
  // 保持对全局对象的零引用（便于审计与静态检查）。
  const globalScope = globalThis as typeof globalThis & {
    matchMedia?: (query: string) => MediaQueryList;
  };
  if (typeof globalScope.matchMedia !== "function") {
    return () => undefined;
  }
  const mql = globalScope.matchMedia(query);
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  onChange(mql.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

/**
 * 用户是否要求减少动效。
 * 首帧恒为初始值（与服务端一致），挂载后同步为真实值，并**订阅变化** ——
 * 用户运行中打开「减少动态效果」时页面会立刻降级。
 */
export function usePrefersReducedMotion(forced = false): boolean {
  const [reduced, setReduced] = useState(forced);
  useEffect(() => {
    if (forced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 契约行为：强制降级时首帧必须与服务端一致，挂载后再同步
      setReduced(true);
      return;
    }
    return subscribe(REDUCED_MOTION_QUERY, setReduced);
  }, [forced]);
  return reduced;
}

/** 是否有精确指针（鼠标/触控笔）。触屏返回 false → 组件关闭指针驱动效果。 */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => subscribe(FINE_POINTER_QUERY, setFine), []);
  return fine;
}

/**
 * 综合"是否允许播放动效"。
 * 组件用它做唯一分支：const animated = useMotionAllowed(disableMotion)。
 * 返回 false 时组件应当**完全不注册**监听，而不只是加一个类名。
 */
export function useMotionAllowed(disableMotion = false): boolean {
  const reduced = usePrefersReducedMotion(disableMotion);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 契约行为：首帧必须与 SSR 一致（静态），挂载后才允许启用动效
    setMounted(true);
  }, []);
  return mounted && !reduced;
}
