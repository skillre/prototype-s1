"use client"

import { useEffect } from "react"

/**
 * Listen for a global hotkey with an optional modifier ("mod" maps to
 * Command on macOS and Control elsewhere). Handler always receives the
 * latest closure via the ref-less effect pattern.
 *
 * Example: useHotkey("k", openPalette) → ⌘K / Ctrl+K
 */
export function useHotkey(
  key: string,
  handler: () => void,
  options: { mod?: boolean; enabled?: boolean } = {}
): void {
  const { mod = false, enabled = true } = options

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      const normalized = event.key.toLowerCase()
      if (normalized !== key.toLowerCase()) return
      if (mod && !(event.metaKey || event.ctrlKey)) return
      if (!mod && (event.metaKey || event.ctrlKey || event.altKey)) return
      event.preventDefault()
      handler()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [key, handler, mod, enabled])
}