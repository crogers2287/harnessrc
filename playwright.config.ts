import { defineConfig } from '@playwright/test';
const testOrigin = `http://localhost:${process.env.RC_E2E_PORT || '4080'}`;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: testOrigin,
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node --import tsx scripts/e2e-server.ts',
    url: `${testOrigin}/health`,
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
