import { ago } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { feed, notificationHref, notificationText } from "@/lib/services/notifications";
import { NotificationBell } from "./notification-bell";

/**
 * The bell's data, fetched on its own so the header does not wait for it.
 *
 * `feed` needs a user id, which means it can only run after the session has
 * been resolved — awaiting it in the layout would put a second sequential
 * round trip in front of every page in the app. As its own async component
 * behind `<Suspense>` it streams instead: the header paints, the badge
 * arrives.
 *
 * The strings are resolved here because the translator is a server function
 * and cannot cross into the client component that renders them.
 */
export async function Notifications({ userId }: { userId: number }) {
  const { t } = await getT();
  const { items, unread } = await feed(userId);

  return (
    <NotificationBell
      unread={unread}
      items={items.map((n) => ({
        id: n.id,
        text: notificationText(n, t),
        href: notificationHref(n),
        when: ago(n.created_at, t),
        unread: n.read_at === null,
      }))}
      labels={{
        title: t("notifications"),
        label: t("notificationsLabel", { n: unread }),
        empty: t("notificationsNone"),
        markAll: t("markAllRead"),
      }}
    />
  );
}
