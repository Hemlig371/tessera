import { defineConfig } from '@playwright/test';
export default defineConfig({
  globalTeardown: './tests/support/e2e-teardown.ts',
  testDir: 'tests/e2e', workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:1420', headless: true, trace: 'retain-on-failure', channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  webServer: { command: 'npx vite --config vite.e2e.config.ts', url: 'http://127.0.0.1:1420', reuseExistingServer: false },
});
