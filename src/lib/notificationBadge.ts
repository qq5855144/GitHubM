// 顶栏和通知页共享已确认的未读状态。null 要求重新查询收件箱。

const NOTIFICATION_UNREAD_EVENT = 'githubm:notification-unread';

export function publishNotificationUnread(hasUnread: boolean | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<boolean | null>(NOTIFICATION_UNREAD_EVENT, { detail: hasUnread }));
}

export function subscribeNotificationUnread(listener: (hasUnread: boolean | null) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    listener((event as CustomEvent<boolean | null>).detail);
  };
  window.addEventListener(NOTIFICATION_UNREAD_EVENT, handler);
  return () => window.removeEventListener(NOTIFICATION_UNREAD_EVENT, handler);
}
