import { BlockList, isIP } from 'node:net';

// Login throttling needs the address of the browser, not of a reverse proxy in
// front of it. Forwarded addresses are only read from explicitly trusted peers.
export type TrustedProxies = BlockList;

function plainAddress(value: string): string {
  const address = value.trim().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped && isIP(mapped[1]) === 4 ? mapped[1] : address;
}

const family = (address: string) => isIP(address) === 4 ? 'ipv4' as const : 'ipv6' as const;

export function parseTrustedProxies(value: string | undefined): string[] | undefined {
  const entries = (value ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
  if (!entries.length) return;
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const version = isIP(address);
    const bits = version === 4 ? 32 : 128;
    if (!version || extra !== undefined || (prefix !== undefined && (!/^\d{1,3}$/.test(prefix) || Number(prefix) > bits)))
      throw new Error('IM_OVERDUE_TRUSTED_PROXIES muss eine kommagetrennte Liste von IP-Adressen oder CIDR-Bereichen sein.');
  }
  return entries;
}

export function trustedProxyList(entries: readonly string[] = []): TrustedProxies {
  const list = new BlockList();
  for (const entry of entries) {
    const [address, prefix] = entry.split('/');
    const plain = plainAddress(address);
    if (prefix === undefined) list.addAddress(plain, family(plain));
    else list.addSubnet(plain, Number(prefix), family(plain));
  }
  return list;
}

// Walks X-Forwarded-For from the nearest hop outwards and stops at the first
// address that is not a trusted proxy. Without trusted proxies the header is ignored.
export function clientAddress(peer: string | undefined, forwardedFor: string | string[] | undefined, trusted: TrustedProxies): string | undefined {
  if (!peer || !isIP(plainAddress(peer))) return;
  let address = plainAddress(peer);
  const hops = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor ?? '').split(',').map(plainAddress).filter(Boolean);
  while (hops.length && trusted.check(address, family(address))) {
    const next = hops.pop()!;
    if (!isIP(next)) break;
    address = next;
  }
  return address;
}

function ipv6Groups(address: string): number[] {
  const [head, tail = ''] = address.includes('::') ? address.split('::') : [address];
  const part = (text: string) => text ? text.split(':').flatMap(group => isIP(group) === 4
    ? (([a, b, c, d]) => [a * 256 + b, c * 256 + d])(group.split('.').map(Number))
    : [parseInt(group, 16)]) : [];
  const start = part(head);
  const end = part(tail);
  return [...start, ...Array<number>(8 - start.length - end.length).fill(0), ...end];
}

// One IPv6 client usually controls a whole prefix, so throttle IPv6 per /56.
export function throttleKey(address: string | undefined): string {
  if (!address) return 'unknown';
  if (isIP(address) === 4) return address;
  const groups = ipv6Groups(address);
  return `${groups.slice(0, 3).map(group => group.toString(16)).join(':')}:${(groups[3] & 0xff00).toString(16)}::/56`;
}
