"use client";

import { LogOut, ShieldCheck, Smartphone, Unlink } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { useNow } from "@/lib/hooks";
import { useEmployeeAction, useEmployeeSessions, useUnbindDevice } from "@/lib/queries";
import type { Device } from "@/lib/types";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";

function shortAgent(agent: string | null): string {
  if (!agent) return "-";
  if (/EmployeeCalling/i.test(agent)) return agent.replace(/^EmployeeCalling\//i, "Mobile app ").replace(/\s*\(.*\)/, "");
  if (/Edg\//.test(agent)) return "Edge browser";
  if (/Chrome\//.test(agent)) return "Chrome browser";
  if (/Firefox\//.test(agent)) return "Firefox browser";
  if (/Safari\//.test(agent)) return "Safari browser";
  return agent.slice(0, 40);
}

/** The phones an employee has signed in on, and every sign-in (session) of the account. Administrators can release a phone or sign everything out. */
export function DevicesPanel({ employeeId, employeeName, devices, bound, isAdmin }: { employeeId: number; employeeName: string; devices: Device[]; bound: boolean; isAdmin: boolean }) {
  const sessions = useEmployeeSessions(employeeId);
  const now = useNow(60_000);
  const unbind = useUnbindDevice(employeeId);
  const action = useEmployeeAction(employeeId);
  const [release, setRelease] = React.useState<Device | null>(null);
  const [revokeAll, setRevokeAll] = React.useState(false);

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">Phones</h3>
          {bound ? (
            <Badge tone="violet">
              <ShieldCheck className="size-3.5" /> Locked to the first phone
            </Badge>
          ) : null}
        </div>
        {devices.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-6 text-center text-sm text-muted">This person has not signed in on any phone yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {devices.map((d, i) => (
              <div key={d.id} className="flex items-start gap-3.5 rounded-2xl border border-line bg-surface p-4 shadow-card" data-testid="device-card">
                <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", i === 0 ? "bg-brand-soft text-brand" : "bg-surface-3 text-muted")}>
                  <Smartphone className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{d.device_name ?? "Unknown phone"}</p>
                  <p className="text-xs text-muted">
                    {d.os_version ?? d.platform} · app {d.app_version ?? "?"}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    Last seen <span className="font-semibold text-ink-soft">{timeAgo(d.last_seen_at)}</span> · first seen {formatDateTime(d.first_seen_at)}
                  </p>
                </div>
                {isAdmin ? (
                  <Button variant="ghost" size="xs" onClick={() => setRelease(d)} aria-label={`Release ${d.device_name ?? "phone"}`}>
                    <Unlink className="size-3.5" /> Release
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {isAdmin ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">Sign-ins</h3>
            <Button variant="secondary" size="xs" onClick={() => setRevokeAll(true)}>
              <LogOut className="size-3.5" /> Sign out everywhere
            </Button>
          </div>
          {sessions.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <TableWrap>
              <Table className="min-w-[640px]">
                <THead>
                  <TR>
                    <TH>Signed in</TH>
                    <TH>Last active</TH>
                    <TH>From</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <tbody>
                  {(sessions.data ?? []).slice(0, 12).map((s) => {
                    const expired = Date.parse(s.expires_at) < now;
                    return (
                      <TR key={s.id}>
                        <TD className="whitespace-nowrap text-ink-soft">{formatDateTime(s.created_at)}</TD>
                        <TD className="whitespace-nowrap text-ink-soft">{timeAgo(s.last_used_at)}</TD>
                        <TD>
                          <p className="text-ink-soft">{shortAgent(s.user_agent)}</p>
                          <p className="text-xs text-muted">{s.ip ?? "-"}</p>
                        </TD>
                        <TD>{s.revoked_at ? <Badge tone="neutral">Signed out</Badge> : expired ? <Badge tone="neutral">Expired</Badge> : <Badge tone="brand" dot>Active</Badge>}</TD>
                      </TR>
                    );
                  })}
                  {sessions.data?.length === 0 ? (
                    <TR>
                      <TD colSpan={4} className="py-8 text-center text-muted">
                        No sign-ins yet.
                      </TD>
                    </TR>
                  ) : null}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </section>
      ) : null}

      <ConfirmDialog
        open={release !== null}
        onOpenChange={(o) => !o && setRelease(null)}
        title={`Release ${release?.device_name ?? "this phone"}?`}
        description={`${employeeName} is signed out of this phone. If the account is locked to one phone, the next phone they sign in on becomes the allowed one.`}
        confirmLabel="Release phone"
        onConfirm={async () => {
          if (!release) return;
          await unbind.mutateAsync(release.id);
          toast.success("Phone released");
        }}
      />
      <ConfirmDialog
        open={revokeAll}
        onOpenChange={setRevokeAll}
        title={`Sign ${employeeName} out everywhere?`}
        description="Every phone and browser is signed out at once. They can sign in again with their password."
        confirmLabel="Sign out"
        onConfirm={async () => {
          await action.mutateAsync("revoke-sessions");
          toast.success("Signed out everywhere");
          void sessions.refetch();
        }}
      />
    </div>
  );
}
