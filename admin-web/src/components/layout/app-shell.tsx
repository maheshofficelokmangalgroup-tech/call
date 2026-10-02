"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Menu } from "lucide-react";
import { motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { BrandMark } from "@/components/layout/brand";
import { ChangePasswordDialog } from "@/components/layout/change-password-dialog";
import { CommandPalette, PaletteTrigger } from "@/components/layout/command-palette";
import { navFor } from "@/components/layout/nav";
import { RangePicker } from "@/components/layout/range-picker";
import { MobileDrawer, SidebarContent } from "@/components/layout/sidebar";
import { ThemeChoices, ThemeToggle } from "@/components/layout/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { authRequest } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { useLocalStorage } from "@/lib/use-local-storage";
import { RangeProvider } from "@/lib/range";
import { DEFAULT_TZ, cn } from "@/lib/utils";

const COLLAPSE_KEY = "ec-admin-sidebar";

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy>
      <div className="hidden w-[272px] shrink-0 border-r border-line bg-surface p-5 lg:block">
        <div className="flex items-center gap-3">
          <BrandMark />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="mt-8 space-y-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
      <div className="flex-1 p-8">
        <Skeleton className="h-12 w-full max-w-md" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [collapsedValue, setCollapsedValue] = useLocalStorage(COLLAPSE_KEY, "0");
  const collapsed = collapsedValue === "1";
  // the mobile menu closes by itself when another page is opened: it is "open for" one path only
  const [drawerPath, setDrawerPath] = React.useState<string | null>(null);
  const drawer = drawerPath === pathname;
  const setDrawer = (open: boolean) => setDrawerPath(open ? pathname : null);
  const [palette, setPalette] = React.useState(false);
  const [passwordRequested, setPasswordRequested] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mustChange = me.data?.employee.must_change_password ?? false;
  const passwordOpen = passwordRequested || mustChange;
  const toggleCollapsed = () => setCollapsedValue(collapsed ? "0" : "1");

  const signOut = async () => {
    try {
      await authRequest("logout");
    } catch {
      /* the cookies are cleared server-side either way */
    }
    qc.clear();
    toast.success("Signed out");
    router.replace("/login");
  };

  if (me.isPending) return <ShellSkeleton />;
  if (me.isError || !me.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <ErrorState title="Could not open the panel" message="The server did not answer. Check that it is running, then try again." onRetry={() => me.refetch()} />
      </div>
    );
  }

  const user = me.data.employee;
  const isAdmin = user.role === "admin";
  const current = navFor(pathname);

  return (
    <RangeProvider tz={me.data.config.timezone || DEFAULT_TZ}>
      <div className="min-h-dvh">
        <aside
          className={cn("fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-surface/90 backdrop-blur-xl transition-[width] duration-300 ease-out lg:block", collapsed ? "w-[84px]" : "w-[272px]")}
          aria-label="Navigation"
        >
          <SidebarContent me={user} collapsed={collapsed} onToggle={toggleCollapsed} onSignOut={signOut} />
        </aside>
        <MobileDrawer open={drawer} onClose={() => setDrawer(false)} me={user} collapsed={false} onSignOut={signOut} />

        <div className={cn("transition-[padding] duration-300 ease-out", collapsed ? "lg:pl-[84px]" : "lg:pl-[272px]")}>
          <header className="glass sticky top-0 z-20 border-b border-line">
            <div className="mx-auto flex h-[68px] max-w-[1480px] items-center gap-3 px-4 sm:px-6 lg:px-8">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
              <PaletteTrigger onClick={() => setPalette(true)} className="max-w-sm flex-1 lg:max-w-md" />
              <div className="ml-auto flex items-center gap-2">
                {current?.usesRange ? <RangePicker /> : null}
                <ThemeToggle />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="ml-1 rounded-full outline-none ring-offset-2 ring-offset-background transition-shadow hover:ring-2 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-brand" aria-label="Account menu" data-testid="user-menu">
                      <Avatar name={user.full_name} size="md" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <div className="flex items-center gap-3 px-3 py-3">
                      <Avatar name={user.full_name} size="md" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-ink">{user.full_name}</p>
                        <p className="truncate text-xs text-muted">{user.email}</p>
                        <Badge tone="brand" className="mt-1 capitalize">
                          {user.role}
                        </Badge>
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Appearance</DropdownMenuLabel>
                    <div className="px-2 pb-2">
                      <ThemeChoices />
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setPasswordRequested(true)}>
                      <KeyRound /> Change password
                    </DropdownMenuItem>
                    <DropdownMenuItem danger onSelect={signOut}>
                      <LogOut /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <motion.main key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </motion.main>
        </div>

        <CommandPalette open={palette} onOpenChange={setPalette} isAdmin={isAdmin} />
        <ChangePasswordDialog
          open={passwordOpen}
          onOpenChange={(open) => {
            setPasswordRequested(open);
            if (!open && mustChange) void qc.invalidateQueries({ queryKey: ["me"] });
          }}
          forced={mustChange}
        />
      </div>
    </RangeProvider>
  );
}
