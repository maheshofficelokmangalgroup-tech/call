import { ArrowRightLeft, BookUser, Headphones, LayoutDashboard, Megaphone, PhoneCall, ScrollText, Settings, Users, UsersRound, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** shown only to administrators */
  adminOnly?: boolean;
  /** the page filters by the shared date range, so the top bar shows the range picker there */
  usesRange?: boolean;
  keywords?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, usesRange: true, keywords: "home overview live kpi" }],
  },
  {
    label: "People",
    items: [
      { href: "/employees", label: "Employees", icon: Users, usesRange: true, keywords: "staff team members performance create new" },
      { href: "/teams", label: "Teams", icon: UsersRound, keywords: "groups" },
      { href: "/distribution", label: "Work sharing", icon: ArrowRightLeft, adminOnly: true, keywords: "rebalance inactive working absent split share contacts equally who is working" },
    ],
  },
  {
    label: "Calling",
    items: [
      { href: "/calls", label: "Calls", icon: PhoneCall, usesRange: true, keywords: "history log talk time who called" },
      { href: "/recordings", label: "Recordings", icon: Headphones, usesRange: true, keywords: "audio listen playback" },
    ],
  },
  {
    label: "CRM",
    items: [
      { href: "/contacts", label: "Contacts", icon: BookUser, keywords: "customers leads import assign" },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone, keywords: "targets distribute" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/audit", label: "Audit log", icon: ScrollText, adminOnly: true, usesRange: true, keywords: "security history who did what" },
      { href: "/settings", label: "Settings", icon: Settings, adminOnly: true, keywords: "recording notice targets retry" },
    ],
  },
];

export const flatNav = (isAdmin: boolean): NavItem[] => NAV.flatMap((g) => g.items).filter((i) => isAdmin || !i.adminOnly);

export function navFor(pathname: string): NavItem | undefined {
  return NAV.flatMap((g) => g.items).find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}
