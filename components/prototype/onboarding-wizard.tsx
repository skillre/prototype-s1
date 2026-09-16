"use client"

import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useMessages } from "@/components/i18n/locale-provider"
import { durations, easings } from "@/lib/motion-presets"
import { cn } from "@/lib/utils"

export type WizardData = Record<string, unknown>

export interface WizardStep {
  id: string
  title: string
  description: string
  /** Render the step body. `setData` merges into the collected data. */
  render: (context: {
    data: WizardData
    setData: (key: string, value: unknown) => void
  }) => React.ReactNode
  /** Return an error message to block "Next", or null to allow it. */
  validate?: (data: WizardData) => string | null
}

type OnboardingWizardProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  steps: WizardStep[]
  title?: string
  description?: string
  /** Invoked with ALL collected data when the final step finishes. */
  onComplete: (data: WizardData) => void
  className?: string
  /** Lands on the dialog panel — used by e2e tests. */
  testId?: string
}

/** Generic multi-step onboarding dialog with progress, validation and motion. */
export function OnboardingWizard({
  open,
  onOpenChange,
  steps,
  title,
  description,
  onComplete,
  className,
  testId,
}: OnboardingWizardProps) {
  const t = useMessages()
  const [index, setIndex] = useState(0)
  const [data, setDataState] = useState<WizardData>({})
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = useState(1)

  const step = steps[index]
  const isFirst = index === 0
  const isLast = index === steps.length - 1

  const progress = useMemo(() => ((index + 1) / steps.length) * 100, [index, steps.length])

  const setData = (key: string, value: unknown) =>
    setDataState((current) => ({ ...current, [key]: value }))

  const goTo = (nextIndex: number, dir: number) => {
    if (nextIndex > index && step?.validate) {
      const message = step.validate(data)
      if (message) {
        setError(message)
        return
      }
    }
    setError(null)
    setDirection(dir)
    setIndex(nextIndex)
  }

  const finish = () => {
    if (step?.validate) {
      const message = step.validate(data)
      if (message) {
        setError(message)
        return
      }
    }
    onComplete(data)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Reset for the next run once the exit animation is done.
      window.setTimeout(() => {
        setIndex(0)
        setDataState({})
        setError(null)
        setDirection(1)
      }, 220)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid={testId}
        className={cn("sm:max-w-lg", className)}
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-lg">{title ?? t.wizard.title}</DialogTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              {t.wizard.step(index + 1, steps.length)}
            </span>
          </div>
          <DialogDescription>{description ?? t.wizard.description}</DialogDescription>
        </DialogHeader>

        {/* Progress track */}
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: durations.normal, ease: easings.outExpo }}
          />
        </div>

        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={step.id}
            custom={direction}
            initial={{ opacity: 0, x: 28 * direction }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 * direction }}
            transition={{ duration: durations.fast, ease: easings.standard }}
            className="min-h-44"
          >
            <div className="mb-1 text-sm font-medium">{step.title}</div>
            <p className="text-caption text-muted-foreground">{step.description}</p>
            <div className="mt-3">{step.render({ data, setData })}</div>
          </motion.div>
        </AnimatePresence>

        {error ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter showCloseButton={false} className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => goTo(index - 1, -1)}
            disabled={isFirst}
          >
            <ArrowLeftIcon />
            {t.wizard.back}
          </Button>
          {isLast ? (
            <Button type="button" onClick={finish}>
              <CheckIcon />
              {t.wizard.finish}
            </Button>
          ) : (
            <Button type="button" onClick={() => goTo(index + 1, 1)}>
              {t.wizard.next}
              <ArrowRightIcon />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}