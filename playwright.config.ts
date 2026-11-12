import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/** E2E runs against a running app: `npm run dev` locally, or E2E_BASE_URL for the Docker stack. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: 0,
  // One at a time: every spec signs in as the same demo people, and their live notifications would cross.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A machine that brings its own Chromium (some CI images): E2E_CHROMIUM=/path/to/chromium
    ...(process.env.E2E_CHROMIUM ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM } } : {}),
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 380, height: 820 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
