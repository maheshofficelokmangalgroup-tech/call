import { Link, useNavigate } from "react-router";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ProgressRing } from "@/components/ProgressRing";
import { QueueCard } from "@/components/QueueCard";
import { RowSkeleton, Skeleton } from "@/components/Skeleton";
import { StatCard } from "@/components/StatCard";
import { SyncBanner } from "@/components/SyncBanner";
import { Text } from "@/components/Text";
import { useSession } from "@/lib/auth";
import { formatDurationWords, greeting, pluralize } from "@/lib/format";
import { isOffline, useDashboard, useQueue, useWrapup } from "@/lib/queries";
import { AMBER_TEXT, colors } from "@/lib/theme";
import { useCallAction } from "@/lib/useCallAction";

export function HomeScreen() {
  const navigate = useNavigate();
  const { employee, config } = useSession();
  const dash = useDashboard();
  const queue = useQueue();
  const wrapup = useWrapup();
  const call = useCallAction();

  const target = Math.max(employee.daily_target ?? 0, dash.data?.daily_target ?? 0);
  const done = dash.data?.completed_calls ?? 0;
  const progress = target > 0 ? done / target : 0;
  const remaining = Math.max(0, target - done);
  const firstLoad = dash.isPending;
  const items = queue.data?.items ?? [];
  const total = queue.data?.total ?? dash.data?.pending_contacts ?? 0;
  const unread = config.unread_notifications;
  const offline = isOffline(dash) || isOffline(queue);
  const waiting = wrapup.data ?? [];

  const refresh = () => {
    void dash.refetch();
    void queue.refetch();
    void wrapup.refetch();
  };

  return (
    <div className="page">
      <header className="home-header">
        <div className="home-hello">
          <Text variant="small" color="muted">
            {greeting()}
          </Text>
          <Text variant="title" as="h1" lines={1}>
            {employee.full_name.split(" ")[0] ?? "there"} 👋
          </Text>
        </div>
        <button type="button" className="icon-btn" onClick={refresh} aria-label="Refresh" data-testid="refresh">
          <Icon name="refresh" size={20} />
        </button>
        <Link to="/notifications" className="icon-btn bell" aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"} data-testid="open-notifications">
          <Icon name="bell" size={22} />
          {unread > 0 ? <span className="bell-badge">{unread > 9 ? "9+" : unread}</span> : null}
        </Link>
      </header>

      <SyncBanner offline={offline} onRetry={refresh} />

      {waiting.length > 0 ? (
        <Link to={`/outcome/${waiting[0].id}`} className="wrapup" data-testid="pending-wrapup">
          <span className="wrapup-icon">
            <Icon name="alert" size={20} color={AMBER_TEXT} />
          </span>
          <span className="wrapup-text">
            <Text variant="h3" color="#7C2D12">
              {pluralize(waiting.length, "call")} waiting for an outcome
            </Text>
            <Text variant="small" color="#9A3412">
              Tap to finish - your report stays accurate.
            </Text>
          </span>
          <Icon name="chevron-right" size={20} color="#9A3412" />
        </Link>
      ) : null}

      <section className="hero">
        <span className="bubble bubble-a" />
        <span className="bubble bubble-b" />
        {firstLoad ? (
          <Skeleton height={132} rounded={20} style={{ backgroundColor: "rgba(255,255,255,0.25)" }} />
        ) : (
          <div className="hero-row">
            <ProgressRing progress={progress} size={128} stroke={12}>
              <Text variant="display" color={colors.white} className="ring-number" data-testid="done-count">
                {done}
              </Text>
              <Text variant="caption" color="rgba(255,255,255,0.85)">
                of {target} calls
              </Text>
            </ProgressRing>
            <div className="hero-text">
              <Text variant="small" color="rgba(255,255,255,0.85)">
                Today’s target
              </Text>
              <Text variant="h1" color={colors.white} className="hero-title">
                {target > 0 && done >= target ? "Target achieved! 🎉" : `${remaining} more to go`}
              </Text>
              <div className="hero-stats">
                <span className="hero-stat">
                  <Icon name="clock" size={14} color={colors.yellow} />
                  <Text variant="caption" color="rgba(255,255,255,0.9)" as="span">
                    {formatDurationWords(dash.data?.total_talk_seconds ?? 0)} talk
                  </Text>
                </span>
                <span className="hero-stat">
                  <Icon name="trending" size={14} color={colors.yellow} />
                  <Text variant="caption" color="rgba(255,255,255,0.9)" as="span">
                    {Math.round(progress * 100)}%
                  </Text>
                </span>
              </div>
            </div>
          </div>
        )}
        <Button
          title={total > 0 ? "Start calling" : "Open my calls"}
          variant="accent"
          size="md"
          icon="phone"
          className="hero-cta"
          onClick={() => void navigate("/queue")}
          testId="start-calling"
        />
      </section>

      <div className="stat-grid">
        {firstLoad ? (
          <>
            <Skeleton height={76} rounded={16} />
            <Skeleton height={76} rounded={16} />
            <Skeleton height={76} rounded={16} />
            <Skeleton height={76} rounded={16} />
          </>
        ) : (
          <>
            <StatCard label="Pending" value={total} icon="list-checks" tone={colors.green} toneSoft={colors.greenSoft} to="/queue" testId="stat-pending" />
            <StatCard label="Callbacks due" value={queue.data?.dueCallbacks ?? dash.data?.callbacks_due ?? 0} icon="calendar-clock" tone={colors.orange} toneSoft={colors.orangeSoft} to="/callbacks" testId="stat-callbacks" />
            <StatCard label="Connected" value={dash.data?.connected_calls ?? 0} icon="phone-call" tone={colors.blue} toneSoft={colors.blueSoft} to="/history?filter=connected" testId="stat-connected" />
            <StatCard label="No answer" value={dash.data?.no_answer_calls ?? 0} icon="phone-missed" tone={colors.red} toneSoft={colors.redSoft} to="/history?filter=missed" testId="stat-noanswer" />
          </>
        )}
      </div>

      <h2 className="section-title t t-h2">Next up</h2>
      <div className="list">
        {queue.isPending ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : items.length === 0 ? (
          <div className="all-clear">
            <Icon name="badge-check" size={26} color={colors.green} />
            <Text variant="bodyMedium" color={colors.greenDark}>
              You’re all caught up. New contacts appear here when they are assigned.
            </Text>
          </div>
        ) : (
          <>
            {items.map((item, index) => (
              <QueueCard
                key={item.contact.id}
                item={item}
                highlight={index === 0}
                showTags={false}
                onCall={() => void call({ contactId: item.contact.id, contactName: item.contact.name, phone: item.contact.phone, campaignId: item.campaign?.id ?? null })}
              />
            ))}
            {total > items.length ? (
              <Button title={`See all ${total} contacts`} variant="soft" size="md" onClick={() => void navigate("/queue")} className="see-all" />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
