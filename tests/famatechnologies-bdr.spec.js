import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGORyTmV31QhynI7QflIA1MkB-29FLbACzL4F4oGmk9vhh4DSrCTSc-2Jgqb2P2V8G3-kgZqBPGBblsVCwA0jCmquFWAM23NqxpQUvfgbfya1dqB0ypUzWD4-kOAWWOgzIuEaoAqlT4VskIqi_P_dWMZ3-ItxhMKsP2-C_kC2Trxiu0TAhLE1TWBk0HlGlzEwBAuQxBCxqAC1AA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Famatechnologies BDR name capture flow';
const TEST_NAME   = 'Famatechnologies BDR name capture flow';

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

async function waitForBotGreeting(page, greetingPoll, greetingBaselines, timeoutMs = 50000) {
  const start = Date.now();
  await page.getByRole('textbox').waitFor({ timeout: Math.min(40000, timeoutMs) }).catch(() => {});
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

test.describe('Famatechnologies BDR — Name Capture Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await page.goto(BOT_URL);

    const CHAT_LABELS = ["Let's chat", "Let's Chat", "Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      const found = await btn.waitFor({ timeout: 50000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      chatBtn = page.getByRole('button', { name: /let.?s chat/i });
      const found = await chatBtn.waitFor({ timeout: 50000 }).then(() => true).catch(() => false);
      if (!found) {
        await page.screenshot({ path: join(REPORT_DIR, 'fama-open-btn-not-found.png') }).catch(() => {});
        throw new Error('[FAMA] Chat button not found');
      }
    }
    await page.screenshot({ path: join(REPORT_DIR, 'fama-startup.png') }).catch(() => {});

    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // ── Step 2: Open text chat ────────────────────────────────────────────────
    // Capture baselines BEFORE clicking so greeting detection is accurate
    const greetingPhrases = [
      'Famatechnologies', 'famatechnologies', 'Noura', 'noura',
      'first and last name', 'first name', 'last name', 'your name', 'name',
      'keyboard', 'Hello', 'hello', 'Welcome', 'welcome', 'help', 'assist',
    ];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }
    await chatBtn.click();

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    console.log('[FAMA] Waiting for bot greeting...');
    const greeting = await waitForBotGreeting(page, greetingPhrases, greetingBase, 50000);
    if (!greeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'fama-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', '');
    }
    expect(greeting, 'Step 3: bot did not send a greeting').toBeTruthy();
    console.log('[TEST] Greeting:', greeting);
    await page.screenshot({ path: join(REPORT_DIR, 'fama-greeting.png') }).catch(() => {});

    // ── Step 4: Send "Natali Test" — only AFTER greeting is confirmed ─────────
    const step5Poll = [
      'Thank', 'thank', 'phone', 'Natali', 'natali',
      'great', 'Great', 'please', 'Please',
      'contact', 'number', 'mobile', 'share', 'provide',
      'enter', 'next', 'continue',
    ];
    const step5Base = {};
    for (const p of step5Poll) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[FAMA] Greeting confirmed — sending "Natali Test"...');
    await sendMessage(page, 'Natali Test');
    console.log('[TEST] User message sent');

    // ── Step 5: Wait for any non-empty bot response ───────────────────────────
    const step5Trigger = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 60000);
    if (!step5Trigger) {
      await page.screenshot({ path: join(REPORT_DIR, 'fama-name-fail.png') }).catch(() => {});
      logFailure('Step 5: Name response', 'no new bot response detected', '');
    }
    expect(step5Trigger, 'Step 5 failed: bot gave no response after sending name').toBeTruthy();
    console.log('[TEST] Bot response received:', step5Trigger);
    await page.screenshot({ path: join(REPORT_DIR, 'fama-after-name.png') }).catch(() => {});

    await page.screenshot({ path: join(REPORT_DIR, 'fama-complete.png') }).catch(() => {});
    console.log('[FAMA] Test complete — greeting and name response verified.');
  });
});
