import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/EmptyState";
import { Icon, type IconName } from "@/components/Icon";
import { ScreenHeader } from "@/components/ScreenHeader";
import { RowSkeleton } from "@/components/Skeleton";
import { SyncBanner } from "@/components/SyncBanner";
import { Text } from "@/components/Text";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/endpoints";
import { isOffline, qk, useNotifications } from "@/lib/queries";
import { colors } from "@/lib/theme";
import { parseIso, timeAgo } from "@/lib/time";
import type { AppNotification } from "@/lib/types";

function iconFor(type: string): { icon: IconName; tone: string; bg: string } {
  if (type === "assignment") return { icon: "users", tone: colors.green, bg: colors.greenSoft };
  if (type.includes("callback")) return { icon: "calendar-clock", tone: colors.orange, bg: colors.orangeSoft };
  return { icon: "bell", tone: colors.blue, bg: colors.blueSoft };
}

export function NotificationsScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refreshMe } = useAuth();
  const notifications = useNotifications();
  const items = notifications.data ?? [];
  const unread = items.filter((n) => !n.is_read).length;

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.notifications });
    await refreshMe();
  };

  const open = (n: AppNotification) => {
    if (!n.is_read) void api.markNotificationRead(n.id).then(reload).catch(() => undefined);
    if (n.type === "assignment") void navigate("/queue");
  };

  const markAll = () => void api.markAllNotificationsRead().then(reload).catch(() => undefined);

  return (
    <div className="page">
      <ScreenHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : undefined}
        back
        right={
          unread > 0 ? (
            <button type="button" className="link-btn" onClick={markAll} data-testid="mark-all-read">
              Mark all read
            </button>
          ) : null
        }
      />
      <SyncBanner offline={isOffline(notifications)} onRetry={() => void notifications.refetch()} />
      {notifications.isPending ? (
        <>
          <RowSkeleton />
          <RowSkeleton />
        </>
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title="Nothing new" message="You’ll be told here when contacts are assigned to you." />
      ) : (
        items.map((item) => {
          const look = iconFor(item.type);
          return (
            <button key={item.id} type="button" className={["row-card", "row-button", !item.is_read ? "unread" : ""].filter(Boolean).join(" ")} onClick={() => open(item)} data-testid="notification">
              <span className="call-icon" style={{ backgroundColor: look.bg, width: 44, height: 44 }}>
                <Icon name={look.icon} size={20} color={look.tone} />
              </span>
              <span className="row-body">
                <Text variant="h3">{item.title}</Text>
                {item.body ? (
                  <Text variant="small" color="muted">
                    {item.body}
                  </Text>
                ) : null}
                <Text variant="caption" color="faint" className="row-last">
                  {timeAgo(parseIso(item.created_at) ?? Date.now())}
                </Text>
              </span>
              {!item.is_read ? <span className="unread-dot" aria-label="Unread" /> : null}
            </button>
          );
        })
      )}
    </div>
  );
}
