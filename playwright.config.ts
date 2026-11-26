import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4318', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium' },
    ...(process.env.IM_OVERDUE_CROSS_BROWSER === '1' ? [
      { name: 'firefox-smoke', testMatch: 'browser-smoke.spec.ts', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 1000 } } },
      { name: 'webkit-smoke', testMatch: 'browser-smoke.spec.ts', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 1000 } } },
    ] : []),
  ],
  webServer: {
    command: 'npx tsx tests/start-browser-server.ts',
    url: 'http://127.0.0.1:4318/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
