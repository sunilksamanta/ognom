import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Buttons follow the design system's `.btn` family:
 *   default / primary = .btn.pri  (accent fill, accent-ink text)
 *   outline / secondary = .btn    (panel-2 fill, hairline border)
 *   ghost   = .btn.qt             (transparent, text-2)
 *   destructive = .btn.dgr        (outline danger)
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-[var(--r-sm)] border font-sans font-medium transition-[background,color,border-color,filter] duration-150 ease-ease focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary font-semibold text-primary-foreground hover:brightness-105",
        outline: "border-line-2 bg-panel-2 text-text hover:bg-hover",
        secondary: "border-line-2 bg-panel-2 text-text hover:bg-hover",
        primary: "border-transparent bg-primary font-semibold text-primary-foreground hover:brightness-105",
        destructive:
          "border-danger/40 bg-transparent text-danger hover:bg-danger/[.14]",
        "destructive-fill": "border-transparent bg-danger text-white hover:brightness-105",
        ghost: "border-transparent bg-transparent text-text-2 hover:bg-hover hover:text-text",
        link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[34px] px-3 text-[length:var(--fs-ui)]",
        sm: "h-[30px] px-[11px] text-[12px]",
        xs: "h-[26px] px-2 text-[11.5px] [&_svg]:size-3",
        lg: "h-10 px-4 text-[13px]",
        icon: "h-[30px] w-[30px] p-0",
        "icon-sm": "h-6 w-6 p-0 [&_svg]:size-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = "button", ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...(asChild ? {} : { type })}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
