import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForBotGreeting, waitForAnyNewOccurrence, sendMessage,
} from './helpers/browser-utils.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGORyTmV30UmJ5Pg7Qlsg0skBa-tW1AIrwKwtl8ASTE-2hwuaLGkUqT4zJ2Q0tf8p49v8pzVGTYw8oFqUQRkBPZQoqOmWhRCm59RE5Agv-safhtaOUTrlyhl03zxYwS3Q4TMCew2ggvQpWhuQIMr_342ufoc_F0cQZv1549Ab2HZzVFmSGFkmrsQJRFAlnphipLQyisPyNsdyCloA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Chronilogix BDR mental health personal support flow';
const TEST_NAME   = 'Chronilogix BDR mental health personal support flow';

function csvEscape(v) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function logFailure(stepLabel, failedPhrase, pageText) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const row = [
    new Date().toISOString(), TEST_NAME, BUG_TITLE, stepLabel, failedPhrase, pageText.slice(0, 400),
  ].map(csvEscape).join(',') + '\n';
  appendFileSync(REPORT_PATH, row);
}

test.describe('Chronilogix BDR — Mental Health Personal Support Flow (Simple)', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await navigateTo(page, BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'chron-s-startup.png') }).catch(() => {});
    await checkAndHandleCloudflare(page, '[CHRON-S]', REPORT_DIR);

    // ── Step 2: Capture baselines, open chat ──────────────────────────────────
    const greetingPhrases = ['Hello', 'Hi', 'welcome', 'name', 'your name', 'help', 'assist', 'Chronilogix', 'Roni', 'support', 'today', 'How can'];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const chatOpened = await openChatWidget(page, {
      prefix: '[CHRON-S]',
      failScreenshotPath: join(REPORT_DIR, 'chron-s-open-btn-not-found.png'),
    });
    if (!chatOpened) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      console.log('[CHRON-S] Chat button not found. Visible buttons:', vis);
      throw new Error(`[CHRON-S] Chat button not found. Visible: ${vis.join(', ')}`);
    }

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greeting = await waitForBotGreeting(page, greetingPhrases, greetingBase, 70000);
    if (!greeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'chron-s-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', '');
    }
    expect(greeting, 'Step 3: bot did not send a greeting').toBeTruthy();
    console.log('[TEST] Greeting:', greeting);
    await page.screenshot({ path: join(REPORT_DIR, 'chron-s-greeting.png') }).catch(() => {});

    // ── Step 4: Send "Natali" ─────────────────────────────────────────────────
    const step5Poll = [
      'Great', 'great', 'Nice', 'nice', 'Hello', 'Hi', 'thanks', 'Thank',
      'Natali', 'natali', 'name', 'help', 'How', 'What', 'please', 'could',
      'Chronilogix', 'regarding', 'assist', 'meet', 'welcome',
    ];
    const step5Base = {};
    for (const p of step5Poll) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'Natali');
    console.log('[TEST] User message sent');

    // ── Step 5: Wait for any bot response ────────────────────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 60000);
    if (!step5Arrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'chron-s-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Name response', 'no bot response after name', '');
    }
    expect(step5Arrived, 'Step 5: bot gave no response after sending name').toBeTruthy();
    console.log('[TEST] Bot response received:', step5Arrived);
    await page.screenshot({ path: join(REPORT_DIR, 'chron-s-after-name.png') }).catch(() => {});

    // ── Step 6: Send "Mental Health" ─────────────────────────────────────────
    await sendMessage(page, 'Mental Health');
    await page.screenshot({ path: join(REPORT_DIR, 'chron-s-after-mental-health.png') }).catch(() => {});

    // ── Step 7: Send "Myself" ─────────────────────────────────────────────────
    await sendMessage(page, 'Myself');
    await page.screenshot({ path: join(REPORT_DIR, 'chron-s-complete.png') }).catch(() => {});
    console.log('[CHRON-S] Test complete — "Myself" sent successfully.');
  });
});
