import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  timeout: 120000,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true
      }
    }
  ]
});
