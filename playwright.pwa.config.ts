import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const bunPath = path.join(process.env.HOME ?? '', '.bun/bin/bun');

export default defineConfig({
  testDir: './tests/pwa',
  workers: 1,
  timeout: 90000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `${bunPath} run build && ${bunPath} run preview -- --host 127.0.0.1 --port 4173`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
