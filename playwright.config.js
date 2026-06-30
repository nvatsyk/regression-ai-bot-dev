import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 120000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: true,
    // ── Anti-bot / Cloudflare stabilisation ──────────────────────────────────
    // These args apply to every test in every workflow without any per-test change.
    launchOptions: {
      args: [
        // Disable the AutomationControlled flag — the primary Cloudflare signal.
        '--disable-blink-features=AutomationControlled',
        // CI sandbox / resource constraints.
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        // Prevent Chrome from advertising itself as "HeadlessChrome" in some paths.
        '--disable-extensions',
        '--disable-plugins-discovery',
        '--disable-default-apps',
        // Reduce timing side-channels.
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        '--window-size=1280,720',
      ],
    },
    // Real-looking Chrome UA — omits "HeadlessChrome".
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  },
});
