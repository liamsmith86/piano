import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const bunPath = path.join(process.env.HOME ?? '', '.bun/bin/bun');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // OSMD's large SVG fixtures can exhaust the local dev server/browser when
  // Playwright defaults to all CPU cores. Two workers keeps the full suite stable.
  workers: process.env.CI ? 1 : 2,
  reporter: 'list',
  timeout: 30000,
  use: {
    baseURL: 'https://localhost:5173',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `${bunPath} run dev`,
    url: 'https://localhost:5173',
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
