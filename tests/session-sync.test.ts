import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectSessionLogout } from '../src/session-sync.js';

class TestChannel extends EventTarget {
  static instances: TestChannel[] = [];
  postMessage = vi.fn();
  close = vi.fn();
  constructor(public name: string) { super(); TestChannel.instances.push(this); }
}

beforeEach(() => {
  TestChannel.instances = [];
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('BroadcastChannel', TestChannel);
  vi.stubGlobal('localStorage', { setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

function storageSignal(value: unknown) {
  window.dispatchEvent(Object.assign(new Event('storage'), { key: 'im-overdue-logout', newValue: JSON.stringify(value) }));
}

it('deduplicates transports and detaches both listeners when closed', () => {
  const listener = vi.fn();
  const sync = connectSessionLogout(listener);
  const channel = TestChannel.instances[0];
  const signal = { type: 'logout', id: 'other-tab' };
  channel.dispatchEvent(new MessageEvent('message', { data: signal }));
  storageSignal(signal);
  expect(listener).toHaveBeenCalledTimes(1);
  sync.close();
  channel.dispatchEvent(new MessageEvent('message', { data: { ...signal, id: 'after-close' } }));
  storageSignal({ ...signal, id: 'after-close' });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(channel.close).toHaveBeenCalledOnce();
  // A StrictMode-style replacement gets its own live listener.
  const replacement = connectSessionLogout(listener);
  storageSignal({ ...signal, id: 'new-mount' });
  expect(listener).toHaveBeenCalledTimes(2);
  replacement.close();
});

it('broadcasts only a logout marker and nonce when browser storage is blocked', () => {
  vi.stubGlobal('localStorage', {
    setItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
    removeItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
  });
  const sync = connectSessionLogout(vi.fn());
  expect(() => sync.publish()).not.toThrow();
  expect(TestChannel.instances[0].postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'logout', id: expect.any(String) });
  sync.close();
});

it('uses storage to send and receive when BroadcastChannel construction fails', () => {
  vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('Unavailable'); } });
  const listener = vi.fn();
  const sync = connectSessionLogout(listener);
  sync.publish();
  expect(localStorage.setItem).toHaveBeenCalledWith('im-overdue-logout', expect.any(String));
  expect(localStorage.removeItem).toHaveBeenCalledWith('im-overdue-logout');
  storageSignal({ type: 'logout', id: 'fallback' });
  expect(listener).toHaveBeenCalledOnce();
  sync.close();
});

it('still publishes a unique marker on LAN HTTP without crypto.randomUUID', () => {
  vi.stubGlobal('crypto', {});
  const sync = connectSessionLogout(vi.fn());
  expect(() => { sync.publish(); sync.publish(); }).not.toThrow();
  const messages = TestChannel.instances[0].postMessage.mock.calls.map(call => call[0] as { type: string; id: string });
  expect(messages).toHaveLength(2);
  expect(messages[0]).toEqual({ type: 'logout', id: expect.any(String) });
  expect(messages[0].id).not.toBe(messages[1].id);
  sync.close();
});

it('ignores malformed or unrelated signals', () => {
  const listener = vi.fn();
  const sync = connectSessionLogout(listener);
  for (const data of [null, 'logout', { type: 'login', id: 'no' }, { type: 'logout' }, { type: 'logout', id: 'x'.repeat(101) }]) {
    TestChannel.instances[0].dispatchEvent(new MessageEvent('message', { data }));
    storageSignal(data);
  }
  window.dispatchEvent(Object.assign(new Event('storage'), { key: 'im-overdue-logout', newValue: '{' }));
  expect(listener).not.toHaveBeenCalled();
  sync.close();
});
