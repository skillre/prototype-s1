"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react"

/**
 * 轻量主题方案（替代 next-themes）：
 * - 主题初始化脚本由 root layout（Server Component）以内联 <script> 输出，
 *   在水合前就设置好 <html class="dark">（React 组件内渲染 <script> 会告警，
 *   所以这里不再任何组件里创建 script 标签）。
 * - 组件侧用 useSyncExternalStore 读取 localStorage / prefers-color-scheme，
 *   hydration 后立即得到正确值，且不触发 react-hooks/set-state-in-effect。
 */

export type ThemeMode = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

const STORAGE_KEY = "theme"

type ThemeContextValue = {
  theme: ThemeMode
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
})

const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  const mql = window.matchMedia("(prefers-color-scheme: dark)")
  mql.addEventListener("change", onChange)
  window.addEventListener("storage", onChange)
  return () => {
    listeners.delete(onChange)
    mql.removeEventListener("change", onChange)
    window.removeEventListener("storage", onChange)
  }
}

function emitChange() {
  listeners.forEach((listener) => listener())
}

function getStoredTheme(): ThemeMode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === "light" || stored === "dark" ? stored : null
  } catch {
    return null
  }
}

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function getServerStoredTheme(): ThemeMode | null {
  return null
}

function getServerSystemDark(): boolean {
  return false
}

function applyThemeClass(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
}

type ThemeProviderProps = {
  children: React.ReactNode
  /** 兼容旧签名，固定为 class 策略，忽略。 */
  attribute?: string
  defaultTheme?: ThemeMode
  enableSystem?: boolean
  disableTransitionOnChange?: boolean
  storageKey?: string
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const stored = useSyncExternalStore(subscribe, getStoredTheme, getServerStoredTheme)
  const systemDark = useSyncExternalStore(subscribe, getSystemDark, getServerSystemDark)

  const theme: ThemeMode = stored ?? "system"
  const resolvedTheme: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme

  // 只做 DOM 同步（无 setState → 不触发 set-state-in-effect）
  useEffect(() => {
    applyThemeClass(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((next: ThemeMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* localStorage 不可用时仅本次会话生效 */
    }
    emitChange()
  }, [])

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}