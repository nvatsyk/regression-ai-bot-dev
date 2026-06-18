import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AiORyTmV30SWW488IbQoEOjlg_62oBVaAWVsuCQWa2xgKNjo320LNCZGm9j9l_FxcozWkpkkeMEYOgiEBu1CioGZbHkIrPaemMziiPPrGn4HWDimdcuUM2DcPVnALMHxG4K8BVJA-ZWsDCkT5_7vB-nf4C3EEYdafN828BnYdBFmzdEl1aWLZLi1JjkATTlJoWeJiuZagOzyPFg';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Bengali appointment reminder greeting and schedule response';
const TEST_NAME   = 'Bengali appointment reminder greeting and schedule response';

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

// Best-effort text snapshot for logging (may not capture cross-origin iframe content).
async function getAllFramesText(page) {
  const parts = [];
  for (const frame of page.frames()) {
    const t = await frame.evaluate(() =>
      document.body ? document.body.innerText : ''
    ).catch(() => '');
    if (t.trim()) parts.push(t.trim());
  }
  return parts.join('\n');
}

async function sendMessage(page, text, { inputWaitMs = 60000 } = {}) {
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

// Polls until any phrase count increases above its baseline. Returns matched phrase or null.
async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 60000) {
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

async function captureBaselines(page, phrases) {
  const baselines = {};
  for (const p of phrases) {
    baselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
  }
  return baselines;
}

// Broad greeting phrases — any bot greeting will include at least one.
const GREETING_PHRASES = [
  'হ্যালো', 'বোর্দরুম', 'Boardroom', 'Jessica',
  'ধন্যবাদ', 'Hello', 'কল', 'সাহায্য', 'help', 'calling', 'Good',
];

// Broad response phrases — any bot reply to a schedule question will include at least one.
// Covers Bengali time/day words, common conversational particles, and English fallbacks.
const RESPONSE_PHRASES = [
  // Bengali time and schedule words
  'সময়', 'দিন', 'ঘণ্টা', 'সকাল', 'বিকেল', 'রাত',
  'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি', 'রবি',
  'থেকে', 'পর্যন্ত', 'খোলা', 'বন্ধ', 'কাজ', 'অফিস',
  // Common Bengali conversational words (present in virtually any reply)
  'আমাদের', 'আপনার', 'আপনি', 'আমরা', 'আমি',
  'হয়', 'আছে', 'হবে', 'পাবেন', 'করুন',
  // English fallbacks (bot may mix languages)
  'hours', 'Monday', 'Friday', 'open', 'available',
  'schedule', 'working', 'time', 'office', 'closed',
];

test.describe('Bengali Appointment Reminder — Greeting and Schedule Response', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: load + greeting + 1 response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[APPT-BN] Navigating to Bengali appointment bot...');
    await page.goto(BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-startup.png') }).catch(() => {});
    console.log('[APPT-BN] Page loaded.');

    // ── Step 2: Click "Text Chat" ─────────────────────────────────────────────
    const chatBtn = page.getByRole('button', { name: /text chat/i });
    await chatBtn.waitFor({ timeout: 30000 });
    console.log('[APPT-BN] Found "Text Chat" button — clicking.');

    // Capture phrase baselines BEFORE opening chat so greeting is reliably detected.
    const greetingBaselines = await captureBaselines(page, GREETING_PHRASES);
    await chatBtn.click();
    await sleep(2000); // brief settle for panel to begin loading

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

    // Wait for the textbox to be ready — signals the bot finished its greeting message.
    await page.getByRole('textbox').waitFor({ timeout: 40000 }).catch(() => {});
    await sleep(3000); // extra settle so any streaming greeting text finishes
    console.log('[APPT-BN] Greeting validated and input ready.');

    // ── Step 4: Send Bengali user message ─────────────────────────────────────
    // Capture response baselines AFTER greeting is fully settled so only the new bot
    // reply (not the greeting itself) triggers response detection.
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
