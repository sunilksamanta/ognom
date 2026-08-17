import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "dlg-ov fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * `.modal` from the design system: bg surface, line-2 border, r-lg radius.
 * Compose the body with <DialogHeader/> (.mhd), <DialogBody/> (.mbd) and
 * <DialogFooter/> (.mft) for the canonical header / scroll / footer rhythm.
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Hide the built-in top-right close button. */
    hideClose?: boolean;
    /** Vertical alignment of the centering wrapper. */
    align?: "center" | "start";
  }
>(({ className, children, hideClose, align = "center", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center p-4",
        align === "start" ? "items-start pt-[96px]" : "items-center"
      )}
    >
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "dlg relative flex w-full max-w-[600px] flex-col overflow-hidden duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "max-h-[calc(100vh-48px)]",
          className
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close className="ico absolute right-3 top-3">
            <X />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

/** `.mhd` */
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("dlg-hd flex shrink-0 flex-col gap-[5px] px-[22px] pb-[14px] pr-14 pt-5", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

/** `.mbd` - the scrolling body */
const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("dlg-bd flex min-h-0 flex-1 flex-col gap-[14px] overflow-auto px-[22px] pb-5 pt-1", className)}
    {...props}
  />
);
DialogBody.displayName = "DialogBody";

/** `.mft` */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "dlg-ft flex shrink-0 items-center justify-end gap-2 px-[22px] py-[13px]",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-sans text-[17px] font-semibold leading-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("font-mono text-[11.5px] leading-[1.4] text-text-3", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
