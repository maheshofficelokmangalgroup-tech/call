import Link from "next/link";
import * as React from "react";

import { Avatar } from "@/components/ui/avatar";
import { PRESENCE_META } from "@/components/ui/presence";
import type { Presence } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Avatar + name + one line of detail; a coloured dot on the avatar shows whether the person is active right now. */
export function EmployeeCell({
  id,
  name,
  subtitle,
  presence,
  size = "sm",
  linked = true,
  className,
}: {
  id?: number;
  name: string;
  subtitle?: React.ReactNode;
  presence?: Presence;
  size?: "xs" | "sm" | "md" | "lg";
  linked?: boolean;
  className?: string;
}) {
  const meta = presence ? PRESENCE_META[presence] : null;
  const body = (
    <>
      <span className="relative shrink-0">
        <Avatar name={name} size={size} />
        {meta ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-surface" title={meta.label}>
            <span className={cn("size-2 rounded-full", meta.dot)} />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold text-ink transition-colors group-hover:text-brand">{name}</span>
        {subtitle ? <span className="block truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
    </>
  );
  const classes = cn("flex min-w-0 items-center gap-3", className);
  return id !== undefined && linked ? (
    <Link href={`/employees/${id}`} className={cn(classes, "group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand")} onClick={(e) => e.stopPropagation()}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
