import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat, lstat, symlink, link } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

// All mounts, volumes and containers are disposable and unique to this invocation.
const image = process.argv[2] ?? 'im-overdue:test';
const password = 'container-check-only-passphrase';
const prefix = `im-overdue-check-${randomUUID().slice(0, 8)}`;
const root = await mkdtemp(join(tmpdir(), `${prefix}-`));
const containers = new Set();
const volumes = new Set();
const servers = new Set();
const execute = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = name => console.log(`PASS ${name}`);
let platform;

async function command(binary, args, timeout = 60_000) {
  try { return (await execute(binary, args, { timeout, maxBuffer: 1024 * 1024 })).stdout.trim(); }
  catch (error) {
    // execFile errors include the full command line, which can contain the test password.
    const detail = String(error.stderr ?? '').replaceAll(password, '[redacted]').replace(/im_overdue_session=[a-f0-9]+/g, 'im_overdue_session=[redacted]').slice(-1600);
    // eslint-disable-next-line preserve-caught-error -- the cause would carry the unredacted command line.
    throw new Error(`${binary} ${args[0] ?? ''} failed (exit ${error.code ?? 'timeout'}): ${detail}`);
  }
}
const docker = (...args) => command('docker', args);
const inspect = async name => JSON.parse(await docker('inspect', name))[0];
async function directory(name) { const path = join(root, name); await mkdir(path); return path; }
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function request(app, path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const url = new URL(path, app.url);
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, {
      method, rejectUnauthorized: false, agent: false,
      headers: { Host: new URL(app.origin).host, ...(method === 'GET' || method === 'HEAD' ? {} : { Origin: app.origin }),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }),
        ...(cookie ? { Cookie: cookie } : {}), ...headers },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('HTTP request timed out')));
    req.on('error', reject);
    req.end(data);
  });
}
const json = response => JSON.parse(response.bytes.toString());
async function expectStatus(app, path, status, options) {
  const result = await request(app, path, options);
  assert.equal(result.status, status, `${options?.method ?? 'GET'} ${path} status`);
  return result;
}
async function start(mount, { origin, env = {}, user, extraMounts = [] } = {}, ready = true) {
  const port = await freePort();
  origin ??= `http://localhost:${port}`;
  const name = `${prefix}-${containers.size}`;
  containers.add(name);
  const config = { HOST: '0.0.0.0', IM_OVERDUE_ORIGIN: origin, IM_OVERDUE_PASSWORD: password, PUID: '99', PGID: '100', ...env };
  const args = ['run', '-d', '--platform', platform, '--name', name, '--publish', `127.0.0.1:${port}:4317`, '--mount', mount];
  for (const extra of extraMounts) args.push('--mount', extra);
  if (user) args.push('--user', user);
  for (const [key, value] of Object.entries(config)) if (value !== undefined) args.push('--env', `${key}=${value}`);
  await docker(...args, image);
  const app = { name, port, origin, url: `http://127.0.0.1:${port}` };
  if (ready) await waitReady(app);
  return app;
}
async function waitReady(app) {
  for (let n = 0; n < 150; n++) {
    if (!(await inspect(app.name)).State.Running) throw new Error('Container exited before readiness');
    try { if ((await request(app, '/api/health')).status === 200) return; } catch { /* starting */ }
    await pause(200);
  }
  throw new Error('Container readiness timed out');
}
async function stop(app) {
  await docker('stop', '--time', '10', app.name);
  const state = (await inspect(app.name)).State;
  assert.equal(state.ExitCode, 0, 'SIGTERM must stop cleanly without SIGKILL');
  assert.equal(state.OOMKilled, false);
}
async function login(app) {
  const result = await expectStatus(app, '/api/auth/login', 200, { method: 'POST', body: { password } });
  const header = result.headers['set-cookie']?.[0];
  assert.ok(header?.includes('HttpOnly') && header.includes('SameSite=Strict'), 'private strict session cookie');
  assert.equal(/; Secure(?:;|$)/i.test(header), app.origin.startsWith('https:'), 'cookie transport policy');
  return header.split(';')[0];
}
async function state(app, cookie) { return json(await expectStatus(app, '/api/state', 200, { cookie })); }
async function addNote(app, cookie, text) {
  const current = await state(app, cookie);
  return json(await expectStatus(app, '/api/notes/day/2026-10-01', 200, {
    method: 'PUT', cookie, body: { text, expectedRevision: current.revision },
  }));
}
async function runtimeIdentity(app, uid, gid) {
  const status = await docker('exec', app.name, 'cat', '/proc/1/status');
  assert.match(status, new RegExp(`^Uid:\\s+${uid}\\s+${uid}\\s+${uid}\\s+${uid}$`, 'm'));
  assert.match(status, new RegExp(`^Gid:\\s+${gid}\\s+${gid}\\s+${gid}\\s+${gid}$`, 'm'));
  // Docker Desktop bind mounts can report ownership relative to the caller.
  // Check as the actual app identity, also proving it can traverse private data.
  const files = JSON.parse(await docker('exec', '--user', `${uid}:${gid}`, app.name, 'node', '-e',
    'const f=require("node:fs"); console.log(JSON.stringify(["/data",...f.readdirSync("/data").map(x=>"/data/"+x)].map(p=>{const s=f.statSync(p);return {p,uid:s.uid,gid:s.gid,mode:s.mode&511}})))'));
  for (const file of files) {
    assert.equal(file.uid, uid, 'data owner'); assert.equal(file.gid, gid, 'data group');
    assert.equal(file.mode, file.p === '/data' ? 0o700 : 0o600, 'private data permissions');
  }
}
async function healthcheck(app) {
  await docker('exec', app.name, '/usr/local/bin/im-overdue-entrypoint', '--healthcheck');
  for (let n = 0; n < 180; n++) {
    const health = (await inspect(app.name)).State.Health.Status;
    if (health === 'healthy') return;
    assert.notEqual(health, 'unhealthy', 'Docker healthcheck');
    await pause(250);
  }
  throw new Error('Docker health status timed out');
}
async function mountedEntries(path) {
  const name = `${prefix}-${containers.size}`;
  containers.add(name);
  return JSON.parse(await docker('run', '--rm', '--platform', platform, '--name', name,
    '--entrypoint', 'node', '--mount', `type=bind,src=${path},dst=/data`, image,
    '-e', 'console.log(JSON.stringify(require("node:fs").readdirSync("/data")))'));
}
async function rejectStartup(name, env, prepare = async () => {}) {
  const path = await directory(name);
  await prepare(path);
  const before = await readdir(path);
  const entries = await Promise.all(before.map(async entry => {
    const file = join(path, entry);
    const info = await lstat(file);
    return { file, uid: info.uid, gid: info.gid, mode: info.mode,
      bytes: info.isFile() ? await readFile(file) : undefined };
  }));
  const app = await start(`type=bind,src=${path},dst=/data`, { env }, false);
  for (let n = 0; n < 100; n++) {
    const current = (await inspect(app.name)).State;
    if (!current.Running) {
      assert.notEqual(current.ExitCode, 0, `${name} must fail startup`);
      assert.deepEqual(await mountedEntries(path), before, `${name} must not create a database`);
      for (const entry of entries) {
        const info = await lstat(entry.file);
        for (const key of ['uid', 'gid', 'mode']) assert.equal(info[key], entry[key], `${name} must preserve ${key}`);
        if (entry.bytes) assert.deepEqual(await readFile(entry.file), entry.bytes, `${name} must preserve content`);
      }
      return;
    }
    await pause(100);
  }
  throw new Error(`${name} unexpectedly remained running`);
}

try {
  const metadata = JSON.parse(await docker('image', 'inspect', image))[0];
  platform = `${metadata.Os}/${metadata.Architecture}`;
  assert.equal(metadata.Os, 'linux');
  assert.equal(metadata.Config.Labels?.['org.opencontainers.image.licenses'], 'PolyForm-Noncommercial-1.0.0');
  const bind = await directory('bind');
  const mount = `type=bind,src=${bind},dst=/data`;
  const app = await start(mount);
  const licenseFiles = ['LICENSE', 'NOTICE', 'COMMERCIAL-LICENSE.md', 'CONTRIBUTING.md'];
  const expectedLicenses = Object.fromEntries(await Promise.all(licenseFiles.map(async name =>
    [name, await readFile(new URL('../' + name, import.meta.url), 'utf8')])));
  const packagedLicenses = JSON.parse(await docker('exec', '--user', '99:100', app.name, 'node', '-e',
    'const fs=require("node:fs");const names=["LICENSE","NOTICE","COMMERCIAL-LICENSE.md","CONTRIBUTING.md"];console.log(JSON.stringify(Object.fromEntries(names.map(name=>[name,fs.readFileSync("/app/"+name,"utf8")]))))'));
  assert.deepEqual(packagedLicenses, expectedLicenses, 'unmodified project licensing documents in the image');
  const bundledLicenses = JSON.parse(await docker('exec', '--user', '99:100', app.name, 'node', '-e',
    'const fs=require("node:fs");const names=["react.LICENSE","react-dom.LICENSE","lucide-react.LICENSE","manrope.LICENSE"];console.log(JSON.stringify(names.map(name=>fs.readFileSync("/app/third-party-licenses/"+name,"utf8"))))'));
  for (const text of bundledLicenses) {
    assert.ok(text.length > 500, 'bundled dependency license must be complete, not just a URL');
    assert.match(text, /copyright/i);
  }
  pass('PolyForm metadata, unchanged project notices and bundled UI/font licenses');
  assert.deepEqual(json(await expectStatus(app, '/api/health', 200)), { ok: true });
  for (const path of ['/api/state', '/api/backup', '/api/timesheet']) await expectStatus(app, path, 401);
  await expectStatus(app, '/api/backup', 401, { method: 'HEAD' });
  await expectStatus(app, '/api/auth/login', 403, { method: 'POST', body: { password }, headers: { Origin: 'https://evil.invalid' } });
  await expectStatus(app, '/api/state', 403, { headers: { Host: 'evil.invalid', 'X-Forwarded-Host': new URL(app.origin).host, 'X-Forwarded-Proto': 'https' } });
  await expectStatus(app, '/api/auth/login', 403, { method: 'POST', body: { password }, headers: { Origin: 'https://evil.invalid', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': new URL(app.origin).host } });
  let cookie = await login(app);
  const expected = await addNote(app, cookie, 'Isolated container persistence check');
  await runtimeIdentity(app, 99, 100);
  await healthcheck(app);
  pass('HTTP authentication, Host/Origin, UID/GID, permissions and Docker health');

  const backup = (await expectStatus(app, '/api/backup', 200, { cookie })).bytes;
  assert.equal(backup.subarray(0, 16).toString(), 'SQLite format 3\0');
  const backupPath = join(root, 'backup.sqlite');
  await writeFile(backupPath, backup);
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(backupPath, { readOnly: true });
  try { assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
  finally { database.close(); }
  await expectStatus(app, '/api/auth/logout', 204, { method: 'POST', cookie });
  await expectStatus(app, '/api/state', 401, { cookie });
  cookie = await login(app);
  await stop(app);
  await docker('start', app.name);
  await waitReady(app);
  await expectStatus(app, '/api/state', 401, { cookie });
  cookie = await login(app);
  assert.deepEqual(await state(app, cookie), expected);
  await stop(app);
  const restored = await directory('restored');
  await writeFile(join(restored, 'im-overdue.sqlite'), backup);
  const restoreApp = await start(`type=bind,src=${restored},dst=/data`);
  assert.deepEqual(await state(restoreApp, await login(restoreApp)), expected);
  await stop(restoreApp);
  pass('logout, restart invalidation, bind persistence, consistent backup and offline restore');

  // This security probe needs the Linux VM filesystem; Desktop host sharing
  // does not enforce the same root-owned directory barrier on bind mounts.
  const raceVolume = `${prefix}-race`;
  volumes.add(raceVolume);
  await docker('volume', 'create', raceVolume);
  const raceMount = `type=volume,src=${raceVolume},dst=/data`;
  const seedName = `${prefix}-${containers.size}`;
  containers.add(seedName);
  await docker('run', '--rm', '--platform', platform, '--name', seedName,
    '--entrypoint', 'node', '--mount', raceMount,
    '--mount', `type=bind,src=${backupPath},dst=/backup.sqlite,readonly`, image,
    '-e', 'require("node:fs").copyFileSync("/backup.sqlite","/data/im-overdue.sqlite")');
  const raceChecks = await directory('race-checks');
  const raceControl = await directory('race-control');
  await writeFile(join(raceChecks, 'chown'), `#!/bin/sh
for argument in "$@"; do
  if [ "$argument" = /data/im-overdue.sqlite ] && [ ! -e /control/resume ]; then
    if [ -e /control/fail ]; then exit 42; fi
    : > /control/paused
    while [ ! -e /control/resume ]; do sleep 0.1; done
  fi
done
exec /bin/chown "$@"
`, { mode: 0o755 });
  const raceApp = await start(raceMount, {
    env: { PATH: '/checks:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
    extraMounts: [`type=bind,src=${raceChecks},dst=/checks,readonly`, `type=bind,src=${raceControl},dst=/control`],
  }, false);
  let paused = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    paused = await stat(join(raceControl, 'paused')).then(() => true, () => false);
    if (paused) break;
    assert.equal((await inspect(raceApp.name)).State.Running, true, 'race probe container must remain running');
    await pause(100);
  }
  assert.ok(paused, 'entrypoint must reach the first privileged database chown');
  await docker('exec', '--user', '99:100', raceApp.name, 'node', '-e', `
    const fs=require('node:fs'),assert=require('node:assert/strict');
    const operations=[()=>fs.renameSync('/data/im-overdue.sqlite','/data/swapped'),
      ()=>fs.symlinkSync('/app/package.json','/data/injected')];
    const results=operations.map(operation=>{try{operation();return 'allowed'}catch(error){return error.code}});
    assert.deepEqual(results,['EACCES','EACCES'],'app UID must be excluded during privileged child-path operations');
  `);
  await writeFile(join(raceControl, 'resume'), 'resume');
  await waitReady(raceApp);
  assert.deepEqual(await state(raceApp, await login(raceApp)), expected);
  await runtimeIdentity(raceApp, 99, 100);
  await stop(raceApp);
  pass('app UID cannot rename or inject data entries during privileged initialization');

  const rollbackVolume = `${prefix}-rollback`;
  volumes.add(rollbackVolume);
  await docker('volume', 'create', rollbackVolume);
  const rollbackMount = `type=volume,src=${rollbackVolume},dst=/data`;
  const rollbackSnapshot = async (seed = false) => {
    const name = `${prefix}-${containers.size}`;
    containers.add(name);
    return JSON.parse(await docker('run', '--rm', '--platform', platform, '--name', name,
      '--entrypoint', 'node', '--mount', rollbackMount,
      '--mount', `type=bind,src=${backupPath},dst=/backup.sqlite,readonly`, image, '-e', `
        const fs=require('node:fs');
        ${seed ? "fs.copyFileSync('/backup.sqlite','/data/im-overdue.sqlite');fs.chownSync('/data',1234,1235);fs.chmodSync('/data',0o750);" : ''}
        const s=fs.statSync('/data');
        console.log(JSON.stringify({uid:s.uid,gid:s.gid,mode:s.mode&511,
          digest:require('node:crypto').createHash('sha256').update(fs.readFileSync('/data/im-overdue.sqlite')).digest('hex')}));
      `));
  };
  const beforeRollback = await rollbackSnapshot(true);
  const rollbackControl = await directory('rollback-control');
  await writeFile(join(rollbackControl, 'fail'), 'fail before database chown');
  const rollbackApp = await start(rollbackMount, {
    env: { PATH: '/checks:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
    extraMounts: [`type=bind,src=${raceChecks},dst=/checks,readonly`, `type=bind,src=${rollbackControl},dst=/control`],
  }, false);
  let rollbackState;
  for (let attempt = 0; attempt < 100; attempt++) {
    rollbackState = (await inspect(rollbackApp.name)).State;
    if (!rollbackState.Running) break;
    await pause(100);
  }
  assert.equal(rollbackState.Running, false, 'injected initialization failure must exit');
  assert.equal(rollbackState.ExitCode, 42, 'injected database chown failure must propagate');
  assert.deepEqual(await rollbackSnapshot(), beforeRollback, 'EXIT trap must restore directory owner/mode and preserve database');
  pass('failed privileged initialization restores original directory ownership and mode');

  const volume = `${prefix}-data`;
  volumes.add(volume);
  await docker('volume', 'create', volume);
  const volumeMount = `type=volume,src=${volume},dst=/data`;
  const custom = { env: { PUID: '1245', PGID: '1246' } };
  const volumeApp = await start(volumeMount, custom);
  const volumeState = await addNote(volumeApp, await login(volumeApp), 'Named volume persistence');
  await runtimeIdentity(volumeApp, 1245, 1246);
  await stop(volumeApp);
  const nonRoot = await start(volumeMount, { ...custom, user: '1245:1246' });
  assert.deepEqual(await state(nonRoot, await login(nonRoot)), volumeState);
  await runtimeIdentity(nonRoot, 1245, 1246);
  await stop(nonRoot);
  pass('named volume, custom numeric UID/GID and preconfigured non-root startup');

  await rejectStartup('missing-password', { IM_OVERDUE_PASSWORD: undefined });
  await rejectStartup('missing-origin', { IM_OVERDUE_ORIGIN: undefined });
  await rejectStartup('root-uid', { PUID: '0' });
  await rejectStartup('invalid-gid', { PGID: 'invalid' });
  await rejectStartup('foreign-content', {}, path => writeFile(join(path, 'unrelated.txt'), 'keep'));
  const target = join(root, 'protected-target');
  await writeFile(target, 'unchanged outside target', { mode: 0o640 });
  const original = await stat(target);
  const fingerprint = createHash('sha256').update(await readFile(target)).digest('hex');
  await rejectStartup('symlink', {}, path => symlink(target, join(path, 'im-overdue.sqlite')));
  await rejectStartup('hardlink', {}, path => link(target, join(path, 'im-overdue.sqlite')));
  const after = await stat(target);
  assert.equal(createHash('sha256').update(await readFile(target)).digest('hex'), fingerprint);
  for (const key of ['uid', 'gid', 'mode', 'size', 'mtimeMs']) assert.equal(after[key], original[key], `outside target ${key}`);
  pass('rejected configuration, foreign content, symlinks and hard links preserve data');

  const key = join(root, 'proxy.key');
  const cert = join(root, 'proxy.crt');
  await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost']);
  let upstream;
  const proxyBodyLimit = 31 * 1024 * 1024;
  const proxy = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    let size = 0;
    const chunks = [];
    const rejectBody = () => { chunks.length = 0; res.writeHead(413); res.end(); req.resume(); };
    if (Number(req.headers['content-length']) > proxyBodyLimit) { rejectBody(); return; }
    req.on('data', chunk => {
      size += chunk.length;
      if (size > proxyBodyLimit) { if (!res.writableEnded) rejectBody(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      const forwarded = http.request({ hostname: '127.0.0.1', port: upstream, path: req.url, method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      forwarded.on('error', () => { if (!res.writableEnded) { res.writeHead(502); res.end(); } });
      forwarded.end(Buffer.concat(chunks));
    });
  });
  servers.add(proxy);
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  const origin = `https://localhost:${proxy.address().port}`;
  const secure = await start(`type=bind,src=${await directory('https')},dst=/data`, { origin });
  upstream = secure.port;
  secure.url = `https://127.0.0.1:${proxy.address().port}`;
  const secureCookie = await login(secure);
  await expectStatus(secure, '/api/state', 200, { cookie: secureCookie, headers: { 'X-Forwarded-Host': 'evil.invalid', 'X-Forwarded-Proto': 'http' } });
  await expectStatus(secure, '/api/state', 403, { cookie: secureCookie, headers: { Host: 'evil.invalid', 'X-Forwarded-Host': new URL(origin).host } });
  const beforePreview = await state(secure, secureCookie);
  const importText = JSON.stringify({ schemaVersion: 1, activities: [{ source: 'github', id: 'container-check',
    start: '2026-10-01T08:00:00Z', end: null, title: 'Synthetic proxy preview', url: null }] }) + '\t'.repeat(4 * 1024 * 1024);
  const importBody = { format: 'json', text: importText };
  assert.ok(Buffer.byteLength(importText) <= 5 * 1024 * 1024, 'raw import stays within 5 MiB');
  assert.ok(Buffer.byteLength(JSON.stringify(importBody)) > 6 * 1024 * 1024, 'JSON envelope exceeds 6 MiB');
  const preview = json(await expectStatus(secure, '/api/import/preview', 200, { method: 'POST', cookie: secureCookie, body: importBody }));
  assert.equal(preview.counts.new, 1);
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(await state(secure, secureCookie), beforePreview, 'preview must not write product data');
  await expectStatus(secure, '/api/import/preview', 413, { method: 'POST', cookie: secureCookie,
    headers: { 'Content-Length': String(proxyBodyLimit + 1) } });
  pass('HTTPS proxy accepts escaped import envelope above 6 MiB and enforces 31 MiB cap');
  await expectStatus(secure, '/api/auth/logout', 204, { method: 'POST', cookie: secureCookie });
  await expectStatus(secure, '/api/state', 401, { cookie: secureCookie });
  await healthcheck(secure);
  pass('real HTTPS proxy, Secure cookie, logout and internal Docker health');

  await docker('exec', secure.name, 'node', '-e', `
    const fs=require('node:fs');
    const forbidden=['react','react-dom','lucide-react','@fontsource-variable/manrope','typescript','vite','vitest','tsx','@playwright/test'];
    for(const p of forbidden)if(fs.existsSync('/app/node_modules/'+p))throw Error('Development dependency in runtime');
    for(const p of ['/app/tests','/app/src','/app/data','/usr/local/bin/npm','/usr/local/bin/npx','/usr/local/lib/node_modules/npm'])if(fs.existsSync(p))throw Error('Build or development content in runtime');
    for(const name of ['cc','gcc','g++','make','tsc','vite'])for(const dir of process.env.PATH.split(':'))if(fs.existsSync(dir+'/'+name))throw Error('Compiler in runtime');
  `);
  const usage = await docker('stats', '--no-stream', '--format', '{{.MemUsage}}', secure.name);
  console.log(`PASS runtime inventory; image=${metadata.Size} bytes; idle RAM=${usage}; platform=${platform}`);
  await stop(secure);
} catch (error) {
  console.error(`FAIL ${String(error.message).replaceAll(password, '[redacted]').replace(/im_overdue_session=[a-f0-9]+/g, 'im_overdue_session=[redacted]')}`);
  process.exitCode = 1;
} finally {
  for (const server of servers) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  for (const name of containers) await docker('rm', '-f', name).catch(() => {});
  for (const name of volumes) await docker('volume', 'rm', name).catch(() => {});
  // The host CI user cannot traverse bind mounts after the container makes them
  // private to PUID. A disposable root helper removes only this invocation's files.
  const cleanupName = `${prefix}-cleanup`;
  try {
    if (platform) await docker('run', '--rm', '--platform', platform, '--name', cleanupName,
      '--entrypoint', 'node', '--mount', `type=bind,src=${root},dst=/cleanup`, image, '-e',
      'const f=require("node:fs");for(const p of f.readdirSync("/cleanup"))f.rmSync("/cleanup/"+p,{recursive:true,force:true})');
    await rm(root, { recursive: true, force: true });
  } catch {
    console.error(`FAIL temporary data cleanup: ${root}`);
    process.exitCode = 1;
  } finally { await docker('rm', '-f', cleanupName).catch(() => {}); }
}
