"use client";

import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, ShieldAlert, Wifi, WifiOff } from "lucide-react";

import { Tip } from "@/components/ui/tooltip";
import type { Device, DeviceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const PERMISSION_LABEL: Record<string, string> = {
  phone: "Phone",
  call_log: "Call log",
  microphone: "Microphone",
  notifications: "Notifications",
  contacts: "Contacts",
  battery: "Battery optimisation",
};

export const permissionLabel = (key: string) => PERMISSION_LABEL[key] ?? key.replace(/_/g, " ");

/** What is wrong with a phone, in words an administrator can act on (an empty list: nothing to worry about). */
export function deviceProblems(status: DeviceStatus | null | undefined): string[] {
  if (!status) return [];
  const problems: string[] = [];
  if (status.permissions_ok === false) problems.push(status.missing_permissions.length ? `Not allowed: ${status.missing_permissions.map(permissionLabel).join(", ")}` : "A permission is missing");
  if (status.network === "none") problems.push("The phone has no internet");
  if (status.battery_percent !== null && status.battery_percent <= 15 && !status.charging) problems.push(`Battery at ${status.battery_percent}%`);
  if (status.pending_sync !== null && status.pending_sync >= 20) problems.push(`${status.pending_sync} things are waiting to be sent`);
  if (status.clock_skew_seconds !== null && Math.abs(status.clock_skew_seconds) > 120) problems.push("The phone's clock is wrong, so call times may be wrong");
  return problems;
}

/** The last report saved on a phone's own record, in the shape of a live one (an older phone, or an app that is closed). */
export function statusFromDevice(d: Device): DeviceStatus | null {
  if (!d.last_heartbeat_at) return null;
  return {
    live: false,
    last_heartbeat_at: d.last_heartbeat_at,
    app_state: d.app_state ?? null,
    battery_percent: d.battery_percent ?? null,
    charging: d.charging ?? null,
    network: d.network_type ?? null,
    permissions_ok: d.permissions_ok ?? null,
    missing_permissions: (d.missing_permissions ?? "").split(",").filter(Boolean),
    pending_sync: d.pending_sync ?? null,
    clock_skew_seconds: d.clock_skew_seconds ?? null,
  };
}

function BatteryIcon({ percent, charging }: { percent: number; charging: boolean | null }) {
  if (charging) return <BatteryCharging className="size-4" />;
  if (percent <= 20) return <BatteryLow className="size-4" />;
  if (percent <= 60) return <BatteryMedium className="size-4" />;
  return <BatteryFull className="size-4" />;
}

/** The phone's own report: battery, network, whether the app is open, and a warning when something stops it from working. */
export function DeviceHealth({ status, className }: { status: DeviceStatus | null | undefined; className?: string }) {
  if (!status) return <span className={cn("text-xs text-faint", className)}>No report from the phone yet</span>;
  const problems = deviceProblems(status);
  const low = status.battery_percent !== null && status.battery_percent <= 20 && !status.charging;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-ink-soft", className)} data-testid="device-health">
      <span className={cn("inline-flex items-center gap-1", status.live ? "text-brand-strong" : "text-muted")}>
        <span className={cn("size-1.5 rounded-full", status.live ? "bg-brand" : "bg-faint")} />
        {status.live ? (status.app_state === "background" ? "App in the background" : "App open") : "Last report"}
      </span>
      {status.battery_percent !== null ? (
        <span className={cn("inline-flex items-center gap-1", low && "text-danger")}>
          <BatteryIcon percent={status.battery_percent} charging={status.charging} />
          {status.battery_percent}%
        </span>
      ) : null}
      {status.network ? (
        <span className={cn("inline-flex items-center gap-1", status.network === "none" && "text-danger")}>
          {status.network === "none" ? <WifiOff className="size-4" /> : <Wifi className="size-4" />}
          {status.network === "wifi" ? "Wi-Fi" : status.network === "cellular" ? "Mobile data" : status.network === "none" ? "No internet" : "Online"}
        </span>
      ) : null}
      {problems.length ? (
        <Tip label={problems.join(" · ")}>
          <span className="inline-flex items-center gap-1 text-warn" data-testid="device-problem">
            <ShieldAlert className="size-4" />
            {problems.length === 1 ? "1 problem" : `${problems.length} problems`}
          </span>
        </Tip>
      ) : null}
    </div>
  );
}

/** One small mark for the employee list: nothing when all is well, an icon with the reason when it is not. */
export function DeviceFlag({ status }: { status: DeviceStatus | null | undefined }) {
  const problems = deviceProblems(status);
  if (!problems.length) return null;
  return (
    <Tip label={problems.join(" · ")}>
      <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn" data-testid="device-flag">
        <ShieldAlert className="size-3" />
        {problems.length}
      </span>
    </Tip>
  );
}
