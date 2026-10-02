"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<React.ComponentRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(function TabsList({ className, ...props }, ref) {
  return <TabsPrimitive.List ref={ref} className={cn("flex items-center gap-1 overflow-x-auto border-b border-line", className)} {...props} />;
});

interface TabsTriggerProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  /** current tab value, so the sliding underline knows which trigger is active */
  active?: boolean;
  /** unique id of the tab group: lets two tab bars on one page animate independently */
  group?: string;
  count?: number;
}

/** A tab with an underline that glides to the selected one. */
export const TabsTrigger = React.forwardRef<React.ComponentRef<typeof TabsPrimitive.Trigger>, TabsTriggerProps>(function TabsTrigger(
  { className, children, active, group = "tabs", count, ...props },
  ref,
) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "relative -mb-px inline-flex items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-semibold text-muted outline-none transition-colors hover:text-ink data-[state=active]:text-ink",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-bold leading-5 text-ink-soft">{count}</span> : null}
      {active ? <motion.span layoutId={`${group}-underline`} className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand" transition={{ type: "spring", stiffness: 500, damping: 38 }} /> : null}
    </TabsPrimitive.Trigger>
  );
});

export const TabsContent = React.forwardRef<React.ComponentRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn("pt-5 outline-none", className)} {...props} />;
});
