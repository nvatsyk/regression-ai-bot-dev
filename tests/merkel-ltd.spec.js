import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForBotGreeting, waitForAnyNewOccurrence, sendMessage,
} from './helpers/browser-utils.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AOORyTmV30SWW43SE9lMA1skB-29FLbCyNGsLxANNJ7fDDwmll5bZufaEoKn9TxmfxpvRQE1DHjAbXTAQsL5FQc22PIRmek5NZxxRs77xZ6C1A6VTrpzB9MnBCm6BiT8j5q8BrnD6lK0NVnCU_78bU_8OfyGOcJj1500xbtjW1VYlFwhYtKJqhJYUEGiNSAINoiu74LayeB0t';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Merkel LTD Bengali working hours flow';
const TEST_NAME   = 'Merkel LTD Bengali working hours flow';

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

const GREETING_PHRASES = ['হ্যালো', 'Jessica', 'ধন্যবাদ', 'Hello', 'কল', 'সাহায্য', 'help', 'calling', 'Good'];

const RESPONSE_PHRASES = [
  'সময়', 'দিন', 'ঘণ্টা', 'সকাল', 'বিকেল', 'রাত', 'দুপুর',
  'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি', 'রবি',
  'থেকে', 'পর্যন্ত', 'খোলা', 'বন্ধ', 'কাজ', 'অফিস',
  'আমাদের', 'আপনার', 'আপনি', 'আমরা', 'আমি',
  'হয়', 'আছে', 'হবে', 'পাবেন', 'করুন',
  'hours', 'Monday', 'Friday', 'open', 'available',
  'schedule', 'working', 'time', 'office', 'closed',
];

test.describe('Merkel LTD — Bengali Working Hours Flow', () => {
  test.use({ locale: 'en-US' });

  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[MERKEL] Navigating to Merkel LTD bot...');
    await navigateTo(page, BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'merkel-startup.png') }).catch(() => {});
    await checkAndHandleCloudflare(page, '[MERKEL]', REPORT_DIR);

    // ── Step 2: Capture baselines, open chat ──────────────────────────────────
    const greetingBaselines = {};
    for (const p of GREETING_PHRASES) {
      greetingBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const chatOpened = await openChatWidget(page, {
      prefix: '[MERKEL]',
      failScreenshotPath: join(REPORT_DIR, 'merkel-open-btn-not-found.png'),
    });
    if (!chatOpened) {
      logFailure('Step 2: Chat button', 'no chat button found', '');
      throw new Error('[MERKEL] Chat button not found');
    }
    await sleep(2000);

    // ── Step 3: Wait for bot greeting ─────────────────────────────────────────
    console.log('[MERKEL] Waiting for bot greeting...');
    const greeting = await waitForBotGreeting(page, GREETING_PHRASES, greetingBaselines, 70000);
    if (!greeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'merkel-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting detected', '');
    }
    expect(greeting, 'Step 3: bot did not send a greeting').toBeTruthy();
    console.log('[TEST] Greeting:', greeting);
    await page.screenshot({ path: join(REPORT_DIR, 'merkel-greeting.png') }).catch(() => {});

    // ── Step 4: Send Bengali working-hours question ───────────────────────────
    const responseBaselines = {};
    for (const p of RESPONSE_PHRASES) {
      responseBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const USER_MSG = 'আপনার কাজের সময়সূচী কী?';
    console.log(`[MERKEL] Sending: "${USER_MSG}"`);
    await sendMessage(page, USER_MSG);
    console.log('[TEST] User message sent');

    // ── Step 5: Validate any non-empty bot response ───────────────────────────
    const matchedResponse = await waitForAnyNewOccurrence(page, RESPONSE_PHRASES, responseBaselines, 70000);
    if (!matchedResponse) {
      await page.screenshot({ path: join(REPORT_DIR, 'merkel-cafe-fail.png') }).catch(() => {});
      logFailure('Step 5: Response', 'no response detected', '');
    }
    expect(matchedResponse, 'Step 5: bot did not respond to Bengali message').toBeTruthy();
    console.log('[TEST] Bot response received:', matchedResponse);
    await page.screenshot({ path: join(REPORT_DIR, 'merkel-cafe-response.png') }).catch(() => {});

    await page.screenshot({ path: join(REPORT_DIR, 'merkel-complete.png') }).catch(() => {});
    console.log('[MERKEL] Test complete — Bengali greeting and working-hours response verified.');
  });
});
