import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { initializeApplication } from './startup.js';

const { config, db, app } = await initializeApplication(process.env);
const { port, host } = config;
const server = createServer(app);
let closeVite: (() => Promise<void>) | undefined;
if (process.env.NODE_ENV === 'development') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server, host: '127.0.0.1' }, watch: { ignored: ['**/data/**', '**/test-results/**', '**/playwright-report/**', '**/dist-server/**'] } }, appType: 'spa' });
  app.use(vite.middlewares);
  closeVite = () => vite.close();
} else {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const dist = resolve(projectRoot, 'dist');
  app.use(express.static(dist, { index: false }));
  app.get(/.*/, (_req, res) => { res.sendFile(resolve(dist, 'index.html')); });
}

server.listen(port, host, () => {
  console.log(`im-overdue: ${config.origin ?? `http://${host}:${port}`}`);
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // Close the development websocket before waiting for the HTTP server to drain.
  await closeVite?.();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void shutdown(); });
}
