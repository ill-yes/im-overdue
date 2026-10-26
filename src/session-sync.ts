const channelName = 'im-overdue-session';
const storageKey = 'im-overdue-logout';

type LogoutSignal = { type: 'logout'; id: string };

// The signal carries no session credentials or private application data.
export function connectSessionLogout(onLogout: () => void) {
  let channel: BroadcastChannel | undefined;
  const received = new Set<string>();
  const receive = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const signal = value as Partial<LogoutSignal>;
    if (signal.type !== 'logout' || typeof signal.id !== 'string' || signal.id.length > 100 || received.has(signal.id)) return;
    received.add(signal.id);
    if (received.size > 32) received.delete(received.values().next().value!);
    onLogout();
  };
  const onMessage = (event: MessageEvent<unknown>) => receive(event.data);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey || !event.newValue) return;
    try { receive(JSON.parse(event.newValue)); } catch { /* Ignore unrelated or malformed storage. */ }
  };
  try {
    channel = new BroadcastChannel(channelName);
    channel.addEventListener('message', onMessage);
  } catch { /* Storage events also support browsers without BroadcastChannel. */ }
  window.addEventListener('storage', onStorage);

  return {
    publish() {
      // This is a deduplication nonce, not a credential. LAN HTTP may lack randomUUID.
      const signal: LogoutSignal = { type: 'logout', id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}` };
      try { channel?.postMessage(signal); } catch { /* Still try storage if the channel is unavailable. */ }
      try {
        localStorage.setItem(storageKey, JSON.stringify(signal));
        localStorage.removeItem(storageKey);
      } catch { /* BroadcastChannel continues to work when storage is blocked. */ }
    },
    close() {
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      window.removeEventListener('storage', onStorage);
    },
  };
}
