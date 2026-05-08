import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 120000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: true,
  },
});
