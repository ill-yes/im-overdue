import { describe, expect, it } from 'vitest';
import { clientAddress, parseTrustedProxies, throttleKey, trustedProxyList } from '../server/client-address.js';

describe('login client address', () => {
  it('uses the socket peer and ignores forwarded headers without trusted proxies', () => {
    const none = trustedProxyList();
    expect(clientAddress('192.0.2.1', '203.0.113.7', none)).toBe('192.0.2.1');
    expect(clientAddress('::ffff:192.0.2.1', undefined, none)).toBe('192.0.2.1');
    expect(clientAddress(undefined, '203.0.113.7', none)).toBeUndefined();
  });

  it('follows X-Forwarded-For only through trusted proxies, from the nearest hop outwards', () => {
    const trusted = trustedProxyList(['172.16.0.0/12', '::1', '10.0.0.5']);
    expect(clientAddress('172.17.0.2', '203.0.113.7', trusted)).toBe('203.0.113.7');
    expect(clientAddress('::ffff:172.17.0.2', '6.6.6.6, 203.0.113.7', trusted)).toBe('203.0.113.7');
    expect(clientAddress('::1', ['6.6.6.6, 203.0.113.7', '10.0.0.5'], trusted)).toBe('203.0.113.7');
    expect(clientAddress('172.17.0.2', '', trusted)).toBe('172.17.0.2');
    expect(clientAddress('172.17.0.2', 'not-an-ip', trusted)).toBe('172.17.0.2');
    expect(clientAddress('192.0.2.1', '203.0.113.7', trusted)).toBe('192.0.2.1');
  });

  it('groups IPv6 clients by /56 prefix and keeps IPv4 addresses exact', () => {
    expect(throttleKey('203.0.113.7')).toBe('203.0.113.7');
    expect(throttleKey('2001:db8:1:12::1')).toBe('2001:db8:1:0::/56');
    expect(throttleKey('2001:db8:1:ff:a:b:c:d')).toBe('2001:db8:1:0::/56');
    expect(throttleKey('2001:db8:1:100::1')).toBe('2001:db8:1:100::/56');
    expect(throttleKey('::1')).toBe('0:0:0:0::/56');
    expect(throttleKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/56');
    expect(throttleKey(undefined)).toBe('unknown');
  });

  it('parses trusted proxy configuration strictly', () => {
    expect(parseTrustedProxies(undefined)).toBeUndefined();
    expect(parseTrustedProxies(' ')).toBeUndefined();
    expect(parseTrustedProxies('172.16.0.0/12, 10.0.0.5,fd00::/8')).toEqual(['172.16.0.0/12', '10.0.0.5', 'fd00::/8']);
    for (const value of ['true', 'loopback', '10.0.0.0/33', 'fd00::/129', '10.0.0.0/8/1', '10.0.0.0/', 'example.com'])
      expect(() => parseTrustedProxies(value), value).toThrow('IM_OVERDUE_TRUSTED_PROXIES');
  });
});
