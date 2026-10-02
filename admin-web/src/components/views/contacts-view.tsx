"use client";

import { BookUser, FileUp, Plus, Search, Send, UserMinus, X } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";

import { AssignDialog } from "@/components/domain/assign-dialog";
import { CallDrawer } from "@/components/domain/call-drawer";
import { ContactDrawer } from "@/components/domain/contact-drawer";
import { ContactFormDialog } from "@/components/domain/contact-form-dialog";
import { ImportWizard } from "@/components/domain/import-wizard";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { useDebounced, useKeyedState, usePageReset } from "@/lib/hooks";
import { useCampaigns, useContactMutations, useContacts, useEmployeeList, useMe } from "@/lib/queries";
import { PRIORITY_LABEL, contactStatus, CONTACT_STATUS } from "@/lib/status";
import { useCallParam } from "@/lib/use-call-param";
import { cn, formatPhone, pluralize, timeAgo } from "@/lib/utils";

const PAGE_SIZE = 25;
const NO_CONTACTS = new Set<number>();

export function ContactsView() {
  const me = useMe();
  const isAdmin = me.data?.employee.role === "admin";
  const [search, setSearch] = React.useState("");
  const q = useDebounced(search, 300);
  const [status, setStatus] = React.useState("all");
  const [priority, setPriority] = React.useState("all");
  const [employee, setEmployee] = React.useState("all");
  const [campaign, setCampaign] = React.useState("all");
  const [sort, setSort] = React.useState("recent");
  const [page, setPage] = usePageReset([q, status, priority, employee, campaign, sort]);

  const selectionKey = JSON.stringify([q, status, priority, employee, campaign, page]);
  const [selected, setSelected] = useKeyedState<Set<number>>(NO_CONTACTS, selectionKey);
  const [allMatching, setAllMatching] = useKeyedState(false, selectionKey);
  const [formOpen, setFormOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [unassignOpen, setUnassignOpen] = React.useState(false);
  const [contactId, setContactId] = React.useState<number | null>(null);
  const [openCall, setOpenCall] = useCallParam();

  const unassigned = employee === "none";
  const employees = useEmployeeList({ isActive: true, role: "employee" });
  const campaigns = useCampaigns();
  const { unassign } = useContactMutations();
  const list = useContacts({
    q: q || undefined,
    status: status === "all" ? undefined : status,
    priority: priority === "all" ? null : Number(priority),
    employeeId: employee === "all" || unassigned ? null : Number(employee),
    campaignId: campaign === "all" ? null : Number(campaign),
    unassigned,
    sort,
    page,
  });
  const items = React.useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const filtered = !!(q || status !== "all" || priority !== "all" || employee !== "all" || campaign !== "all");

  const pageIds = items.map((c) => c.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const toggleAll = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (allOnPage) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  const toggleOne = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clear = () => {
    setSearch("");
    setStatus("all");
    setPriority("all");
    setEmployee("all");
    setCampaign("all");
  };

  const count = allMatching ? total : selected.size;
  const request = allMatching
    ? { q: q || undefined, status: status === "all" ? undefined : status, unassigned_only: unassigned, campaign_id: campaign === "all" ? undefined : Number(campaign) }
    : { contact_ids: [...selected] };

  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Contacts"
        description="The people your employees call. Search them, hand them out to employees, or add many at once from a sheet."
        actions={
          isAdmin ? (
            <>
              <Button variant="secondary" onClick={() => setImportOpen(true)} data-testid="import-open">
                <FileUp className="size-4" /> Import sheet
              </Button>
              <Button onClick={() => setFormOpen(true)} data-testid="new-contact">
                <Plus className="size-4" /> New contact
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, number, city, tag" className="pl-10 pr-9" aria-label="Search contacts" data-testid="contact-search" />
          {search ? (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-3" aria-label="Clear search">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {Object.entries(CONTACT_STATUS).map(([value, meta]) => (
              <SelectItem key={value} value={value}>
                {meta.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-40" aria-label="Priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any priority</SelectItem>
            {[1, 2, 3].map((p) => (
              <SelectItem key={p} value={String(p)}>
                {PRIORITY_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin ? (
          <Select value={employee} onValueChange={setEmployee}>
            <SelectTrigger className="w-48" aria-label="Given to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Anyone&apos;s</SelectItem>
              <SelectItem value="none">Not given to anyone</SelectItem>
              {employees.data?.items.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={campaign} onValueChange={setCampaign}>
          <SelectTrigger className="w-48" aria-label="Campaign">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any campaign</SelectItem>
            {campaigns.data?.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-44" aria-label="Order">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Recently added</SelectItem>
            <SelectItem value="name">Name A-Z</SelectItem>
            <SelectItem value="priority">Highest priority</SelectItem>
            <SelectItem value="last_called">Last called</SelectItem>
          </SelectContent>
        </Select>
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X className="size-4" /> Clear filters
          </Button>
        ) : null}
      </div>

      {/* selection bar */}
      {isAdmin && count > 0 ? (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="sticky top-[76px] z-10 mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-brand/30 bg-brand-soft px-4 py-3 shadow-pop" data-testid="selection-bar">
          <p className="text-sm font-bold text-brand-strong">
            {pluralize(count, "contact")} selected
            {!allMatching && allOnPage && total > selected.size ? (
              <button type="button" className="ml-3 font-semibold underline underline-offset-2" onClick={() => setAllMatching(true)}>
                Select all {total.toLocaleString("en-IN")} that match
              </button>
            ) : null}
          </p>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setAssignOpen(true)} data-testid="bulk-assign">
              <Send className="size-4" /> Give to employees
            </Button>
            {!allMatching ? (
              <Button size="sm" variant="secondary" onClick={() => setUnassignOpen(true)}>
                <UserMinus className="size-4" /> Take back
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => { setSelected(new Set()); setAllMatching(false); }}>
              Clear
            </Button>
          </div>
        </motion.div>
      ) : null}

      {list.isError && !list.data ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState message="The contacts could not be loaded." onRetry={() => list.refetch()} />
        </div>
      ) : (
        <>
          <TableWrap className={cn(list.isFetching && !list.isPending && "opacity-80 transition-opacity")}>
            <Table className="min-w-[860px]" data-testid="contact-table">
              <THead>
                <TR>
                  {isAdmin ? (
                    <TH className="w-12">
                      <Checkbox checked={allOnPage ? true : someOnPage ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all on this page" />
                    </TH>
                  ) : null}
                  <TH>Contact</TH>
                  <TH>Status</TH>
                  <TH>Priority</TH>
                  <TH>Place</TH>
                  <TH className="text-right">Calls</TH>
                  <TH>Last called</TH>
                </TR>
              </THead>
              <tbody>
                {list.isPending
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <TR key={i}>
                        <TD colSpan={isAdmin ? 7 : 6}>
                          <Skeleton className="h-9 w-full" />
                        </TD>
                      </TR>
                    ))
                  : items.map((c, i) => {
                      const st = contactStatus(c.status);
                      return (
                        <motion.tr
                          key={c.id}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(i, 14) * 0.02, duration: 0.25 }}
                          onClick={() => setContactId(c.id)}
                          onKeyDown={(e) => e.key === "Enter" && setContactId(c.id)}
                          tabIndex={0}
                          data-testid="contact-row"
                          className={cn("cursor-pointer border-t border-line transition-colors first:border-t-0 hover:bg-surface-2 focus-visible:bg-surface-2", selected.has(c.id) && "bg-brand-soft/40")}
                        >
                          {isAdmin ? (
                            <TD onClick={(e) => e.stopPropagation()}>
                              <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleOne(c.id)} aria-label={`Select ${c.name}`} />
                            </TD>
                          ) : null}
                          <TD>
                            <p className="font-semibold text-ink">{c.name}</p>
                            <p className="text-xs text-muted tnum">{formatPhone(c.phone)}</p>
                          </TD>
                          <TD>
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </TD>
                          <TD>
                            <span className={cn("text-sm font-semibold", c.priority === 1 ? "text-danger" : c.priority === 3 ? "text-muted" : "text-ink-soft")}>{PRIORITY_LABEL[c.priority]}</span>
                          </TD>
                          <TD className="text-ink-soft">{c.location ?? <span className="text-faint">-</span>}</TD>
                          <TD className="text-right font-semibold text-ink tnum">{c.call_count}</TD>
                          <TD className="whitespace-nowrap text-ink-soft">{c.last_called_at ? timeAgo(c.last_called_at) : <span className="text-faint">never</span>}</TD>
                        </motion.tr>
                      );
                    })}
              </tbody>
            </Table>
            {!list.isPending && items.length === 0 ? (
              filtered ? (
                <EmptyState icon={Search} title="No contacts match" description="Try a different search, or clear the filters." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
              ) : (
                <EmptyState icon={BookUser} title="No contacts yet" description="Add one by hand, or import a whole sheet from Excel." action={isAdmin ? <Button onClick={() => setImportOpen(true)}><FileUp className="size-4" /> Import sheet</Button> : undefined} />
              )
            ) : null}
          </TableWrap>
          <div className="mt-4">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </div>
        </>
      )}

      <ContactDrawer contactId={contactId} onClose={() => setContactId(null)} onOpenCall={(id) => setOpenCall(id)} />
      <CallDrawer callId={openCall} onClose={() => setOpenCall(null)} />

      {isAdmin ? (
        <>
          <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} />
          <ImportWizard open={importOpen} onOpenChange={setImportOpen} />
          <AssignDialog open={assignOpen} onOpenChange={setAssignOpen} count={count} request={request} onDone={() => { setSelected(new Set()); setAllMatching(false); }} />
          <ConfirmDialog
            open={unassignOpen}
            onOpenChange={setUnassignOpen}
            title={`Take ${pluralize(selected.size, "contact")} back?`}
            description="They are removed from the employees' call lists. The contacts themselves stay in the system."
            confirmLabel="Take back"
            onConfirm={async () => {
              await unassign.mutateAsync([...selected]);
              toast.success("Contacts taken back");
              setSelected(new Set());
            }}
          />
        </>
      ) : null}
    </div>
  );
}
