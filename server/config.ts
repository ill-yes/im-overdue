export interface RuntimeConfig {
  host: '127.0.0.1' | '0.0.0.0';
  port: number;
  origin?: string;
  password?: string;
  databasePath: string;
}

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length >= 12 && Array.from(value).length <= 256 && Buffer.byteLength(value, 'utf8') <= 1024;
}

export function canonicalOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('IM_OVERDUE_ORIGIN muss eine einzelne HTTP- oder HTTPS-Origin sein.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('IM_OVERDUE_ORIGIN muss eine kanonische HTTP- oder HTTPS-Origin ohne Pfad sein.');
  return value;
}

// Pure configuration parsing: test factories never consult the host environment.
export function readConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const host = env.HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0') throw new Error('HOST muss 127.0.0.1 oder 0.0.0.0 sein.');
  const portText = env.PORT ?? '4317';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT muss zwischen 1 und 65535 liegen.');
  const origin = env.IM_OVERDUE_ORIGIN === undefined ? undefined : canonicalOrigin(env.IM_OVERDUE_ORIGIN);
  const password = env.IM_OVERDUE_PASSWORD;
  if (password !== undefined && !validPassword(password)) throw new Error('IM_OVERDUE_PASSWORD muss 12 bis 256 Zeichen und hoechstens 1024 UTF-8-Bytes enthalten.');
  if ((host === '0.0.0.0' || password !== undefined || origin !== undefined) && (!origin || password === undefined))
    throw new Error('Netzwerk- und Passwortbetrieb benoetigen IM_OVERDUE_ORIGIN und IM_OVERDUE_PASSWORD.');
  return { host, port, origin, password, databasePath: env.IM_OVERDUE_DB ?? 'data/im-overdue.sqlite' };
}
