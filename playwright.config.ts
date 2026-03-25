import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const bunPath = path.join(process.env.HOME ?? '', '.bun/bin/bun');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
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
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
