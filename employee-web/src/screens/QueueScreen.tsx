import { useState } from "react";
import { useSearchParams } from "react-router";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { ContactRow } from "@/components/ContactRow";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { QueueCard } from "@/components/QueueCard";
import { SegmentedControl } from "@/components/SegmentedControl";
import { RowSkeleton } from "@/components/Skeleton";
import { SyncBanner } from "@/components/SyncBanner";
import { Text } from "@/components/Text";
import { formatPhone, pluralize } from "@/lib/format";
import { isOffline, useContactSearch, useQueue } from "@/lib/queries";
import { colors } from "@/lib/theme";
import { useCallAction } from "@/lib/useCallAction";

type Segment = "today" | "all";

export function QueueScreen() {
  const [params] = useSearchParams();
  const [segment, setSegment] = useState<Segment>(params.get("tab") === "all" ? "all" : "today");
  const queue = useQueue();
  const [search, setSearch] = useState("");
  const contacts = useContactSearch(search, segment === "all");
  const call = useCallAction();

  const items = queue.data?.items ?? [];
  const first = items[0];
  const total = queue.data?.total ?? items.length;
  const due = queue.data?.dueCallbacks ?? 0;

  return (
    <div className="page">
      <div className="page-top">
        <Text variant="title" as="h1" className="page-title">
          My contacts
        </Text>
        <SegmentedControl<Segment>
          value={segment}
          onChange={setSegment}
          options={[
            { key: "today", label: "Today's calls", badge: due || undefined },
            { key: "all", label: "All contacts" },
          ]}
        />
        {segment === "all" ? (
          <div className="search">
            <Icon name="search" size={20} color={colors.muted} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, number, city, tag..."
              className="search-input"
              autoComplete="off"
              aria-label="Search contacts"
              data-testid="contact-search"
            />
            {search ? (
              <button type="button" className="search-clear" onClick={() => setSearch("")} aria-label="Clear search">
                <Icon name="x" size={18} color={colors.muted} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {segment === "today" ? (
        <>
          <SyncBanner offline={isOffline(queue)} onRetry={() => void queue.refetch()} />
          {items.length > 0 ? (
            <Text variant="small" color="muted" className="count">
              {pluralize(total, "contact")} to call
              {due > 0 ? `  •  ${pluralize(due, "callback")} due` : ""}
            </Text>
          ) : null}
          <div className="list" data-has-next={first ? "true" : undefined}>
            {queue.isPending ? (
              <>
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </>
            ) : items.length === 0 ? (
              <EmptyState
                icon="badge-check"
                title="All caught up!"
                message="No contacts are waiting right now. New assignments and due callbacks will show up here."
                actionLabel="Refresh"
                onAction={() => void queue.refetch()}
              />
            ) : (
              items.map((item, index) => (
                <QueueCard
                  key={item.contact.id}
                  item={item}
                  highlight={index === 0}
                  showTags={false}
                  onCall={() => void call({ contactId: item.contact.id, contactName: item.contact.name, phone: item.contact.phone, campaignId: item.campaign?.id ?? null })}
                />
              ))
            )}
            {queue.hasNextPage ? <Button title={queue.isFetchingNextPage ? "Loading..." : "Load more"} variant="soft" size="md" onClick={() => void queue.fetchNextPage()} disabled={queue.isFetchingNextPage} className="load-more" /> : null}
          </div>

          {first ? (
            <div className="next-bar" data-testid="next-bar">
              <Avatar name={first.contact.name} size={42} />
              <div className="next-text">
                <Text variant="caption" color="rgba(255,255,255,0.75)">
                  {first.reason === "callback" ? "CALLBACK DUE" : "NEXT UP"}
                </Text>
                <Text variant="h3" color={colors.white} lines={1}>
                  {first.contact.name}
                </Text>
                <Text variant="caption" color="rgba(255,255,255,0.8)" lines={1}>
                  {formatPhone(first.contact.phone)}
                </Text>
              </div>
              <Button
                title="Call"
                icon="phone"
                variant="white"
                size="md"
                onClick={() => void call({ contactId: first.contact.id, contactName: first.contact.name, phone: first.contact.phone, campaignId: first.campaign?.id ?? null })}
                testId="next-call"
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <SyncBanner offline={isOffline(contacts)} onRetry={() => void contacts.refetch()} />
          {contacts.items.length > 0 ? (
            <Text variant="small" color="muted" className="count">
              {pluralize(contacts.total, "contact")}
              {search ? ` matching “${search}”` : " assigned to you"}
            </Text>
          ) : null}
          <div className="list">
            {contacts.isPending || contacts.settling ? (
              <>
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </>
            ) : contacts.items.length === 0 ? (
              <EmptyState
                icon={search ? "search" : "users"}
                title={search ? "No matches" : "No contacts yet"}
                message={search ? "Try a different name, number or city." : "Contacts assigned to you by your administrator will appear here."}
              />
            ) : (
              contacts.items.map((contact) => (
                <ContactRow key={contact.id} contact={contact} onCall={() => void call({ contactId: contact.id, contactName: contact.name, phone: contact.phone })} />
              ))
            )}
            {contacts.hasNextPage ? (
              <Button title={contacts.isFetchingNextPage ? "Loading..." : "Load more"} variant="soft" size="md" onClick={() => void contacts.fetchNextPage()} disabled={contacts.isFetchingNextPage} className="load-more" />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
