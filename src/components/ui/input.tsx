import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-[var(--r-sm)] border border-line bg-panel-2 px-3 py-1 font-mono text-[12.5px] text-text transition-[border-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-text-3 focus-visible:border-accent-line focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-50 read-only:text-text-2",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
