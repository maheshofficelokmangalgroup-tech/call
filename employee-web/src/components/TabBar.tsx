import { Link, useLocation } from "react-router";

import { colors } from "@/lib/theme";

import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

export const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: "/", label: "Home", icon: "home" },
  { path: "/queue", label: "Calls", icon: "list-checks" },
  { path: "/dial", label: "Dial", icon: "phone" },
  { path: "/history", label: "History", icon: "history" },
  { path: "/profile", label: "Profile", icon: "user" },
];

interface Props {
  /** callbacks that are due now (badge on the Calls tab) */
  due: number;
  name: string;
  code: string;
}

/**
 * Bottom navigation on a phone (a bar with a dial button in the middle), a side menu on a computer. Nothing in it moves or animates.
 */
export function TabBar({ due, name, code }: Props) {
  const { pathname } = useLocation();
  return (
    <nav className="tabbar" aria-label="Main">
      <Link to="/" className="brand" aria-label="Employee Calling home">
        <span className="brand-mark">
          <Icon name="phone-call" size={22} color={colors.green} />
        </span>
        <Text variant="h2" as="span">
          Employee Calling
        </Text>
      </Link>
      {TABS.map((tab) => {
        const active = tab.path === "/" ? pathname === "/" : pathname === tab.path || pathname.startsWith(`${tab.path}/`);
        const dial = tab.path === "/dial";
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={["tab", dial ? "tab-dial" : "", active ? "tab-on" : ""].filter(Boolean).join(" ")}
            aria-current={active ? "page" : undefined}
            aria-label={tab.label}
            data-testid={`tab-${tab.label}`}
          >
            <span className={dial ? "fab" : "tab-icon"}>
              <Icon name={tab.icon} size={dial ? 26 : 24} strokeWidth={active && !dial ? 2.6 : 2.1} />
              {tab.path === "/queue" && due > 0 ? <span className="tab-badge">{due > 9 ? "9+" : due}</span> : null}
            </span>
            <span className="tab-label">{tab.label}</span>
          </Link>
        );
      })}
      <Link to="/profile" className="side-user" aria-label="Your profile">
        <Avatar name={name} size={36} />
        <span className="side-user-text">
          <Text variant="bodyMedium" lines={1}>
            {name}
          </Text>
          <Text variant="caption" color="muted" lines={1}>
            {code}
          </Text>
        </span>
      </Link>
    </nav>
  );
}
