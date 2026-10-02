"use client";

import { ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { BrandMark, BrandName } from "@/components/layout/brand";
import { NAV } from "@/components/layout/nav";
import { Avatar } from "@/components/ui/avatar";
import { Tip } from "@/components/ui/tooltip";
import { useLive } from "@/lib/queries";
import type { Employee } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SidebarProps {
  me: Employee;
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  onSignOut: () => void;
  /** the mobile drawer always shows labels */
  forceExpanded?: boolean;
}

export function SidebarContent({ me, collapsed, onToggle, onNavigate, onSignOut, forceExpanded }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = me.role === "admin";
  const live = useLive();
  const onCall = live.data?.presence.on_call ?? 0;
  const slim = collapsed && !forceExpanded;

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-[68px] shrink-0 items-center gap-3 px-5", slim && "justify-center px-0")}>
        <BrandMark />
        {slim ? null : <BrandName />}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3" aria-label="Main">
        {NAV.map((group) => {
          const items = group.items.filter((i) => isAdmin || !i.adminOnly);
          if (items.length === 0) return null;
          return (
            <div key={group.label}>
              {slim ? <div className="mx-3 mb-2 h-px bg-line" /> : <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">{group.label}</p>}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  const link = (
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none transition-colors",
                        active ? "text-brand-strong" : "text-ink-soft hover:bg-surface-3 hover:text-ink",
                        slim && "justify-center px-0",
                      )}
                    >
                      {active ? <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-brand-soft" transition={{ type: "spring", stiffness: 420, damping: 36 }} /> : null}
                      <Icon className={cn("relative size-[19px] shrink-0 transition-transform duration-200 group-hover:scale-110", active && "text-brand")} strokeWidth={active ? 2.4 : 2} />
                      {slim ? null : <span className="relative truncate">{item.label}</span>}
                      {!slim && item.href === "/dashboard" && onCall > 0 ? (
                        <span className="relative ml-auto inline-flex items-center gap-1.5 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white dark:text-[#04130a]">
                          <span className="size-1.5 animate-pulse rounded-full bg-white dark:bg-[#04130a]" />
                          {onCall} live
                        </span>
                      ) : null}
                    </Link>
                  );
                  return <li key={item.href}>{slim ? <Tip label={item.label} side="right">{link}</Tip> : link}</li>;
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 space-y-2 border-t border-line p-3">
        <div className={cn("flex items-center gap-3 rounded-xl p-2", slim && "justify-center")}>
          <Avatar name={me.full_name} size="sm" />
          {slim ? null : (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink">{me.full_name}</p>
              <p className="truncate text-xs capitalize text-muted">{me.role}</p>
            </div>
          )}
          {slim ? null : (
            <Tip label="Sign out">
              <button type="button" onClick={onSignOut} aria-label="Sign out" className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger">
                <LogOut className="size-4" />
              </button>
            </Tip>
          )}
        </div>
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn("hidden w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-muted transition-colors hover:bg-surface-3 hover:text-ink lg:flex", slim && "justify-center px-0")}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {slim ? null : "Collapse"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The slide-in version used on phones and small tablets. */
export function MobileDrawer({ open, onClose, ...props }: SidebarProps & { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-[rgb(6_12_8/0.5)] backdrop-blur-[2px] lg:hidden" onClick={onClose} />
          <motion.aside
            key="panel"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
            className="fixed inset-y-0 left-0 z-50 w-72 border-r border-line bg-surface shadow-float lg:hidden"
            aria-label="Navigation"
          >
            <SidebarContent {...props} collapsed={false} forceExpanded onNavigate={onClose} />
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
