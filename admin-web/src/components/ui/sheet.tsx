"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/** A panel that slides in from the right - used for call details and forms that sit next to a list. */
export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { width?: string }
>(function SheetContent({ className, children, width = "max-w-xl", ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="anim-overlay fixed inset-0 z-50 bg-[rgb(6_12_8/0.5)] backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn("anim-sheet fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col border-l border-line bg-surface shadow-float outline-none", width, className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 z-10 inline-flex size-9 items-center justify-center rounded-full bg-surface/80 text-muted backdrop-blur transition-colors hover:bg-surface-3 hover:text-ink"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const SheetTitle = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  function SheetTitle({ className, ...props }, ref) {
    return <DialogPrimitive.Title ref={ref} className={cn("text-lg font-extrabold tracking-tight text-ink", className)} {...props} />;
  },
);

export const SheetDescription = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  function SheetDescription({ className, ...props }, ref) {
    return <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted", className)} {...props} />;
  },
);
