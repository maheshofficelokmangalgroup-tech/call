"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useIsClient } from "@/lib/hooks";

/** Light / dark button: the icon spins into place; "system" is available from the user menu. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useIsClient();
  const dark = mounted && resolvedTheme === "dark";

  return (
    <Tip label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <Button variant="ghost" size="icon" onClick={() => setTheme(dark ? "light" : "dark")} aria-label="Toggle theme" data-testid="theme-toggle">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={dark ? "moon" : "sun"}
            initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex"
          >
            {dark ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
          </motion.span>
        </AnimatePresence>
      </Button>
    </Tip>
  );
}

export function ThemeChoices() {
  const { theme, setTheme } = useTheme();
  const options = [
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dark", icon: Moon },
    { key: "system", label: "System", icon: Monitor },
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-3 p-1">
      {options.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => setTheme(key)}
          className={`flex flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors ${theme === key ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink"}`}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}
