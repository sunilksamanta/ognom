import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border px-2 py-[3px] font-mono text-[10.5px] font-normal leading-none transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-accent-line bg-accent-soft text-primary",
        secondary:
          "border-line bg-raised text-text-2",
        destructive:
          "border-danger/30 bg-raised text-danger",
        outline: "border-line bg-raised text-text-2",
        ok: "border-ok/30 bg-raised text-ok",
        warn: "border-warn/30 bg-raised text-warn",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
