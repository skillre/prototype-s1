import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-field border border-input bg-surface/60 px-2.5 py-1 text-base transition-[color,background-color,border-color,box-shadow] duration-hover ease-standard outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground shadow-subtle focus-visible:border-ring focus-visible:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/25 md:text-sm dark:bg-input/25 dark:focus-visible:bg-surface",
        className
      )}
      {...props}
    />
  )
}

export { Input }
