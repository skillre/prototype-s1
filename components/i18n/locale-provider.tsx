"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import {
  DEFAULT_LOCALE,
  getMessages,
  messages as defaultMessages,
  type Locale,
  type Messages,
} from "@/lib/i18n"

type LocaleContextValue = {
  locale: Locale
  /** `t` — the active dictionary. */
  t: Messages
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  t: defaultMessages,
})

/**
 * Supplies the active dictionary to the client tree.
 *
 * There is exactly one locale today, so this adds no runtime cost — it exists
 * so that switching locales later is a state change here rather than a
 * find-and-replace across the whole product.
 */
export function LocaleProvider({
  locale = DEFAULT_LOCALE,
  children,
}: {
  locale?: Locale
  children: ReactNode
}) {
  const value = useMemo<LocaleContextValue>(
    () => ({ locale, t: getMessages(locale) }),
    [locale]
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/** The active dictionary — every component reads user-visible copy through this. */
export function useMessages(): Messages {
  return useContext(LocaleContext).t
}

/** Active locale tag, for `<html lang>`-style needs and date formatting. */
export function useLocale(): Locale {
  return useContext(LocaleContext).locale
}
