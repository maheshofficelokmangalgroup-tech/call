"use client";

import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as React from "react";

import { cn } from "@/lib/utils";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;

export const DropdownMenuContent = React.forwardRef<React.ComponentRef<typeof MenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof MenuPrimitive.Content>>(
  function DropdownMenuContent({ className, sideOffset = 8, ...props }, ref) {
    return (
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cn("anim-pop z-[80] min-w-52 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 text-ink shadow-pop", className)}
          {...props}
        />
      </MenuPrimitive.Portal>
    );
  },
);

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof MenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Item> & { danger?: boolean }
>(function DropdownMenuItem({ className, danger, ...props }, ref) {
  return (
    <MenuPrimitive.Item
      ref={ref}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-3 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted",
        danger && "text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger",
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuLabel = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-faint", className)} {...props} />
);

export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) => (
  <MenuPrimitive.Separator className={cn("-mx-1 my-1.5 h-px bg-line", className)} {...props} />
);
