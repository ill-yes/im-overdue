import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'im-overdue-browser-'));
const child = spawn(process.execPath, ['dist-server/server/index.js'], {
  cwd: process.cwd(), stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', IM_OVERDUE_ORIGIN: undefined, IM_OVERDUE_PASSWORD: undefined, PORT: '4318', IM_OVERDUE_DB: join(directory, 'test.sqlite') },
});
let stopping = false;
const stop = () => { if (!stopping) { stopping = true; child.kill('SIGTERM'); } };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', async code => {
  await rm(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
