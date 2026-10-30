import { describe, expect, it, vi } from 'vitest';
import { canonicalOrigin, readConfig, validPassword } from '../server/config.js';
import { initializeApplication } from '../server/startup.js';

describe('startup configuration', () => {
  it('preserves the local loopback default and explicit database path', () => {
    expect(readConfig({})).toEqual({ host: '127.0.0.1', port: 4317, origin: undefined, password: undefined, databasePath: 'data/im-overdue.sqlite' });
    expect(readConfig({ IM_OVERDUE_DB: '/tmp/isolated.sqlite' }).databasePath).toBe('/tmp/isolated.sqlite');
  });
  it('requires a canonical origin and unchanged password for network mode or local auth', () => {
    const password = '  twelve chars  ';
    expect(readConfig({ HOST: '0.0.0.0', IM_OVERDUE_PASSWORD: password, IM_OVERDUE_ORIGIN: 'https://overdue.example:444' })).toMatchObject({ host: '0.0.0.0', password, origin: 'https://overdue.example:444' });
    expect(readConfig({ IM_OVERDUE_PASSWORD: password, IM_OVERDUE_ORIGIN: 'http://localhost:4317' }).password).toBe(password);
    for (const config of [{ HOST: '0.0.0.0' }, { IM_OVERDUE_PASSWORD: password }, { IM_OVERDUE_ORIGIN: 'https://overdue.example' }, { HOST: 'localhost' }, { HOST: '192.168.1.2' }, { PORT: '' }, { PORT: '1e3' }, { PORT: '65536' }])
      expect(() => readConfig(config)).toThrow();
  });
  it('reads optional trusted reverse proxies for login throttling', () => {
    expect(readConfig({ IM_OVERDUE_TRUSTED_PROXIES: '172.16.0.0/12,::1' }).trustedProxies).toEqual(['172.16.0.0/12', '::1']);
    expect(readConfig({ IM_OVERDUE_TRUSTED_PROXIES: '' }).trustedProxies).toBeUndefined();
    expect(() => readConfig({ IM_OVERDUE_TRUSTED_PROXIES: 'true' })).toThrow();
  });
  it('rejects noncanonical origins without exposing the supplied value', () => {
    for (const origin of ['https://EXAMPLE.com', 'https://example.com/', 'https://example.com:443', 'https://example.com/path', 'https://u:secret@example.com', 'https://example.com?x=1', 'ftp://example.com', 'null', 'https://one.example https://two.example']) {
      expect(() => canonicalOrigin(origin)).toThrow();
      try { canonicalOrigin(origin); } catch (error) { expect(String(error)).not.toContain(origin); }
    }
  });
  it('validates character and UTF-8 byte limits without trimming', () => {
    expect(validPassword('a'.repeat(11))).toBe(false);
    expect(validPassword('a'.repeat(12))).toBe(true);
    expect(validPassword('a'.repeat(256))).toBe(true);
    expect(validPassword('a'.repeat(257))).toBe(false);
    expect(validPassword('😀'.repeat(256))).toBe(true);
    expect(validPassword('😀'.repeat(257))).toBe(false);
    expect(validPassword(' '.repeat(12))).toBe(true);
    expect(validPassword(undefined)).toBe(false);
  });
  it('rejects invalid configuration before the database opener is called', async () => {
    const open = vi.fn();
    await expect(initializeApplication({ HOST: '0.0.0.0', IM_OVERDUE_DB: '/must/not/be/created' }, open)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
    await expect(initializeApplication({ IM_OVERDUE_PASSWORD: 'secret', IM_OVERDUE_ORIGIN: 'http://example.com' }, open)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
});
