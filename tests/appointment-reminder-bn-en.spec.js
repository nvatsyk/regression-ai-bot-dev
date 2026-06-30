import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForAnyNewOccurrence, sendMessage, getAllFramesText, captureBaselines,
} from './helpers/browser-utils.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AiORyTmV30SWW488IbQoEOjlg_62oBVaAWVsuCQWa2xgKNjo320LNCZGm9j9l_FxcozWkpkkeMEYOgiEBu1CioGZbHkIrPaemMziiPPrGn4HWDimdcuUM2DcPVnALMHxG4K8BVJA-ZWsDCkT5_7vB-nf4C3EEYdafN828BnYdBFmzdEl1aWLZLi1JjkATTlJoWeJiuZagOzyPFg';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Bengali appointment reminder greeting and schedule response';
const TEST_NAME   = 'Bengali appointment reminder greeting and schedule response';

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

const GREETING_PHRASES = [
  'হ্যালো', 'বোর্দরুম', 'Boardroom', 'Jessica',
  'ধন্যবাদ', 'Hello', 'কল', 'সাহায্য', 'help', 'calling', 'Good',
];

const RESPONSE_PHRASES = [
  'সময়', 'দিন', 'ঘণ্টা', 'সকাল', 'বিকেল', 'রাত',
  'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি', 'রবি',
  'থেকে', 'পর্যন্ত', 'খোলা', 'বন্ধ', 'কাজ', 'অফিস',
  'আমাদের', 'আপনার', 'আপনি', 'আমরা', 'আমি',
  'হয়', 'আছে', 'হবে', 'পাবেন', 'করুন',
  'hours', 'Monday', 'Friday', 'open', 'available',
  'schedule', 'working', 'time', 'office', 'closed',
];

test.describe('Bengali Appointment Reminder — Greeting and Schedule Response', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[APPT-BN] Navigating to Bengali appointment bot...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-startup.png') }).catch(() => {});
    await checkAndHandleCloudflare(page, '[APPT-BN]', REPORT_DIR);
    console.log('[APPT-BN] Page loaded.');

    // ── Step 2: Capture baselines, open chat ─────────────────────────────────
    const greetingBaselines = await captureBaselines(page, GREETING_PHRASES);

    const chatOpened = await openChatWidget(page, {
      prefix: '[APPT-BN]',
      labels: ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let's Chat", 'Start New Session'],
      failScreenshotPath: join(REPORT_DIR, 'appt-bn-open-btn-not-found.png'),
      timeoutMs: 60000,
    });
    if (!chatOpened) {
      logFailure('Step 2: Chat button', 'no chat button found', '');
      throw new Error('[APPT-BN] Chat button not found');
    }
    console.log('[APPT-BN] Found "Text Chat" button — clicked.');
    await sleep(2000);

    // ── Step 3: Wait for any non-empty bot greeting ───────────────────────────
    console.log('[APPT-BN] Waiting up to 60s for bot greeting...');
    const matchedGreeting = await waitForAnyNewOccurrence(page, GREETING_PHRASES, greetingBaselines, 60000);

    await sleep(1000);
    const actualGreeting = await getAllFramesText(page);
    console.log(`[APPT-BN] Greeting detected via phrase: "${matchedGreeting}"`);
    console.log(`[APPT-BN] Greeting text snapshot: ${actualGreeting.slice(0, 300)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-greeting.png') }).catch(() => {});

    if (!matchedGreeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting detected', actualGreeting);
    }
    expect(matchedGreeting, 'Step 3: bot did not send a greeting').not.toBeNull();

    await page.getByRole('textbox').waitFor({ timeout: 40000 }).catch(() => {});
    await sleep(3000);
    console.log('[APPT-BN] Greeting validated and input ready.');

    // ── Step 4: Send Bengali user message ─────────────────────────────────────
    const responseBaselines = await captureBaselines(page, RESPONSE_PHRASES);

    const USER_MSG = 'আপনার কাজের সময়সূচী কী?';
    console.log(`[APPT-BN] Sending: "${USER_MSG}"`);
    await sendMessage(page, USER_MSG);
    console.log('[APPT-BN] Message sent — waiting for any bot response.');

    // ── Step 5: Validate any non-empty bot response ───────────────────────────
    let msgAppeared = false;
    try {
      await page.getByText(USER_MSG, { exact: false }).waitFor({ timeout: 40000 });
      msgAppeared = true;
    } catch {}
    console.log(`[APPT-BN] User message visible in widget: ${msgAppeared}`);

    const matchedResponse = await waitForAnyNewOccurrence(page, RESPONSE_PHRASES, responseBaselines, 60000);

    await sleep(1000);
    const actualResponse = await getAllFramesText(page);
    console.log(`[APPT-BN] Response detected via phrase: "${matchedResponse}"`);
    console.log(`[APPT-BN] Response text snapshot: ${actualResponse.slice(0, 400)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-after-first-msg.png') }).catch(() => {});

    if (!matchedResponse) {
      await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-final-fail.png') }).catch(() => {});
      logFailure('Step 5: Response', 'no response detected', actualResponse);
    }
    expect(matchedResponse, 'Step 5: bot did not respond to Bengali message').not.toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-complete.png') }).catch(() => {});
    console.log('[APPT-BN] Test complete — Bengali greeting and schedule response verified.');
  });
});
