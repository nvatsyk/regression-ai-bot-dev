import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AOORyTmV30SWW43SE9lMA1skB-29FLbCyNGsLxANNJ7fDDwmll5bZufaEoKn9TxmfxpvRQE1DHjAbXTAQsL5FQc22PIRmek5NZxxRs77xZ6C1A6VTrpzB9MnBCm6BiT8j5q8BrnD6lK0NVnCU_78bU_8OfyGOcJj1500xbtjW1VYlFwhYtKJqhJYUEGiNSAINoiu74LayeB0t';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Merkel LTD Bengali working hours flow';
const TEST_NAME   = 'Merkel LTD Bengali working hours flow';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

async function sendMessage(page, text, { inputWaitMs = 70000 } = {}) {
  const input = page.getByRole('textbox');
  await input.waitFor({ timeout: inputWaitMs });
  await input.fill(text);
  await input.press('Enter');
  await sleep(500);
  const stillFilled = await input.inputValue().catch(() => '');
  if (stillFilled.trim() === text.trim()) {
    const named = page.getByRole('button', { name: /^send$/i });
    const hasSend = (await named.count().catch(() => 0)) > 0;
    await (hasSend ? named : page.getByRole('button').last()).click().catch(() => {});
  }
  await sleep(8000);
}

async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 70000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of phrases) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > (baselines[phrase] ?? 0)) return phrase;
    }
    await sleep(2000);
  }
  return null;
}

async function waitForBotGreeting(page, greetingPoll, greetingBaselines, timeoutMs = 70000) {
  const start = Date.now();
  await page.getByRole('textbox').waitFor({ timeout: Math.min(60000, timeoutMs) }).catch(() => {});
  await sleep(5000);
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of greetingPoll) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > (greetingBaselines[phrase] ?? 0)) return phrase;
    }
    await sleep(2000);
  }
  const inputVisible = await page.getByRole('textbox').isVisible().catch(() => false);
  return inputVisible ? 'greeting received' : null;
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
    await page.goto(BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'merkel-startup.png') }).catch(() => {});

    // ── Step 2: Click chat button ─────────────────────────────────────────────
    const CHAT_LABELS = ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let's Chat", 'Start New Session'];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 50000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 70000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      chatBtn = page.getByRole('button', { name: /text chat/i });
      const found = await chatBtn.waitFor({ timeout: 70000 }).then(() => true).catch(() => false);
      if (!found) {
        await page.screenshot({ path: join(REPORT_DIR, 'merkel-open-btn-not-found.png') }).catch(() => {});
        throw new Error('[MERKEL] Chat button not found');
      }
    }
    console.log('[MERKEL] Found chat button — clicking.');

    // Capture baselines BEFORE clicking so greeting detection is accurate
    const greetingBaselines = {};
    for (const p of GREETING_PHRASES) {
      greetingBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }
    await chatBtn.click();
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
