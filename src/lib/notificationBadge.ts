// 顶栏通知红点共享状态：通知页更新后立即同步，无需重新请求接口。

const NOTIFICATION_UNREAD_EVENT = 'githubm:notification-unread';

export function publishNotificationUnread(hasUnread: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<boolean>(NOTIFICATION_UNREAD_EVENT, { detail: hasUnread }));
}

export function subscribeNotificationUnread(listener: (hasUnread: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    listener(Boolean((event as CustomEvent<boolean>).detail));
  };
  window.addEventListener(NOTIFICATION_UNREAD_EVENT, handler);
  return () => window.removeEventListener(NOTIFICATION_UNREAD_EVENT, handler);
}