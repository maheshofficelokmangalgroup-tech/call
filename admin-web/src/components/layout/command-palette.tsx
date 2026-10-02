"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { CornerDownLeft, Moon, Search, Sun, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import * as React from "react";

import { flatNav } from "@/components/layout/nav";
import { Avatar } from "@/components/ui/avatar";
import { PresenceDot } from "@/components/ui/presence";
import { useEmployeeList } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Ctrl/Cmd + K: jump to a page, find an employee or start a common task without touching the mouse. */
export function CommandPalette({ open, onOpenChange, isAdmin }: { open: boolean; onOpenChange: (open: boolean) => void; isAdmin: boolean }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-overlay fixed inset-0 z-[70] bg-[rgb(6_12_8/0.5)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          aria-label="Command palette"
          className="anim-dialog fixed left-1/2 top-[18%] z-[70] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-3xl border border-line bg-surface shadow-float outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Type to search pages and employees, then press Enter.</DialogPrimitive.Description>
          <PaletteBody onOpenChange={onOpenChange} isAdmin={isAdmin} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The search box and the results. It exists only while the palette is open, so it starts empty every time. */
function PaletteBody({ onOpenChange, isAdmin }: { onOpenChange: (open: boolean) => void; isAdmin: boolean }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = React.useState("");
  const people = useEmployeeList({ q: query.trim() || undefined });

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const item = "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft outline-none data-[selected=true]:bg-brand-soft data-[selected=true]:text-brand-strong [&_svg]:size-4 [&_svg]:text-muted data-[selected=true]:[&_svg]:text-brand";
  const heading = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-faint";

  return (
    <Command shouldFilter={false} loop label="Search" className={heading}>
      <div className="flex items-center gap-3 border-b border-line px-5">
        <Search className="size-5 shrink-0 text-muted" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search pages, employees, actions..."
          className="h-14 w-full bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-faint"
        />
        <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] font-semibold text-muted sm:block">Esc</kbd>
      </div>
      <Command.List className="max-h-[min(60dvh,420px)] overflow-y-auto p-2">
        <Command.Empty className="px-4 py-10 text-center text-sm text-muted">Nothing found for &ldquo;{query}&rdquo;.</Command.Empty>

        {query.trim() && (people.data?.items.length ?? 0) > 0 ? (
          <Command.Group heading="Employees">
            {people.data!.items.slice(0, 6).map((e) => (
              <Command.Item key={e.id} value={`employee-${e.id}`} onSelect={() => go(`/employees/${e.id}`)} className={item}>
                <span className="relative">
                  <Avatar name={e.full_name} size="xs" />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {e.full_name} <span className="text-faint">· {e.employee_code}</span>
                </span>
                {e.is_active ? <PresenceDot presence="online" /> : <span className="text-xs text-faint">inactive</span>}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        <Command.Group heading="Go to">
          {flatNav(isAdmin)
            .filter((n) => !query.trim() || `${n.label} ${n.keywords ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
            .map((n) => (
              <Command.Item key={n.href} value={`page-${n.href}`} onSelect={() => go(n.href)} className={item}>
                <n.icon />
                <span className="flex-1">{n.label}</span>
                <CornerDownLeft className="opacity-0 transition-opacity data-[selected=true]:opacity-100" />
              </Command.Item>
            ))}
        </Command.Group>

        {!query.trim() || "new employee add create".includes(query.trim().toLowerCase()) || "dark light theme mode".includes(query.trim().toLowerCase()) ? (
          <Command.Group heading="Actions">
            {isAdmin ? (
              <Command.Item value="action-new-employee" onSelect={() => go("/employees?new=1")} className={item}>
                <UserPlus /> New employee
              </Command.Item>
            ) : null}
            <Command.Item
              value="action-theme"
              onSelect={() => {
                setTheme(resolvedTheme === "dark" ? "light" : "dark");
                onOpenChange(false);
              }}
              className={item}
            >
              {resolvedTheme === "dark" ? <Sun /> : <Moon />} Switch to {resolvedTheme === "dark" ? "light" : "dark"} mode
            </Command.Item>
          </Command.Group>
        ) : null}
      </Command.List>
    </Command>
  );
}

export function PaletteTrigger({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="palette-trigger"
      className={cn(
        "group flex h-10 w-full max-w-md items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 text-sm text-faint shadow-card transition-colors hover:border-line-strong hover:text-muted",
        className,
      )}
    >
      <Search className="size-4" />
      <span className="flex-1 truncate text-left">Search employees, pages...</span>
      <kbd className="hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted sm:block">Ctrl K</kbd>
    </button>
  );
}
