import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL = 'https://nextlevel.ai/';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Nextlevel.ai BDR greeting and name flow';
const TEST_NAME   = 'Nextlevel.ai BDR greeting and name flow';

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
  let input = null;
  const deadline = Date.now() + inputWaitMs;
  while (Date.now() < deadline && !input) {
    for (const frame of page.frames()) {
      try {
        const el = frame.getByRole('textbox');
        if ((await el.count()) > 0) { input = el; break; }
      } catch (_) {}
    }
    if (!input) await sleep(1000);
  }
  if (!input) throw new Error(`[NL-BDR] Textbox not found after ${inputWaitMs}ms`);
  await input.fill(text);
  await input.press('Enter');
  await sleep(500);
  const stillFilled = await input.inputValue().catch(() => '');
  if (stillFilled.trim() === text.trim()) {
    let sent = false;
    for (const frame of page.frames()) {
      const named = frame.getByRole('button', { name: /^send$/i });
      if ((await named.count().catch(() => 0)) > 0) {
        await named.click().catch(() => {});
        sent = true;
        break;
      }
    }
    if (!sent) await page.getByRole('button').last().click().catch(() => {});
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

test.describe('Nextlevel.ai BDR — Greeting and Name Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[NL-BDR] Navigating to nextlevel.ai...');
    await page.goto(BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);
    await page.screenshot({ path: join(REPORT_DIR, 'nl-startup.png') }).catch(() => {});

    // ── Step 2: Click chat button ─────────────────────────────────────────────
    const CHAT_LABELS = ["Let's Chat", "Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 50000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 70000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      chatBtn = page.getByRole('button', { name: /let.?s chat/i });
      const foundByRole = await chatBtn.waitFor({ timeout: 70000 }).then(() => true).catch(() => false);
      if (!foundByRole) {
        chatBtn = page.getByText(/let.?s chat/i).first();
        await chatBtn.waitFor({ timeout: 70000 });
      }
    }

    // Dismiss cookie consent banner if present (intercepts clicks).
    const cookieSelectors = ['.cmplz-accept', '.cmplz-btn-accept', 'button[aria-label*="Accept"]', 'button[aria-label*="accept"]'];
    for (const sel of cookieSelectors) {
      const btn = page.locator(sel).first();
      const has = await btn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
      if (has) { await btn.click().catch(() => {}); await sleep(500); break; }
    }
    const gotItBtn = page.getByRole('button', { name: /got it|accept|agree/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // Capture baselines BEFORE clicking so greeting detection is accurate
    const greetingPhrases = ['Hello', 'Hi', 'welcome', 'name', 'your name', 'may I have your name', 'help', 'assist', 'NextLevel', 'nextlevel', 'Jessica', 'jessica', 'today'];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }
    await chatBtn.click();
    console.log('[NL-BDR] Clicked chat button — waiting for greeting.');

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greeting = await waitForBotGreeting(page, greetingPhrases, greetingBase, 70000);
    if (!greeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'nl-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', '');
    }
    expect(greeting, 'Step 3: bot did not send a greeting').toBeTruthy();
    console.log('[TEST] Greeting:', greeting);
    await page.screenshot({ path: join(REPORT_DIR, 'nl-greeting.png') }).catch(() => {});

    // ── Step 4: Send "Natali" ─────────────────────────────────────────────────
    const replyPoll = [
      'Natali', 'natali',
      'meet you', 'meet', 'nice to meet', 'great to meet', 'pleasure to meet',
      'phone', 'number', 'email', 'address',
      'Thank you', 'thank you', 'Thanks', 'thanks',
      'please', 'provide', 'could you', 'can you', 'would you',
      'help', 'assist', 'question', 'interested',
    ];
    const replyBaselines = {};
    for (const p of replyPoll) {
      replyBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'Natali');
    console.log('[TEST] User message sent');
    console.log('[NL-BDR] Sent "Natali" — waiting for any bot response.');

    // ── Step 5: Validate bot replied ─────────────────────────────────────────
    const botResponse = await waitForAnyNewOccurrence(page, replyPoll, replyBaselines, 70000);
    if (!botResponse) {
      await page.screenshot({ path: join(REPORT_DIR, 'nl-name-reply-fail.png') }).catch(() => {});
      logFailure('Step 5: Bot reply after name', 'no response received', '');
    }
    expect(botResponse, 'Step 5: bot did not reply after receiving "Natali"').toBeTruthy();
    console.log('[TEST] Bot response received:', botResponse);
    await page.screenshot({ path: join(REPORT_DIR, 'nl-after-name.png') }).catch(() => {});

    await page.screenshot({ path: join(REPORT_DIR, 'nl-complete.png') }).catch(() => {});
    console.log('[NL-BDR] Bot replied after name — test complete.');
  });
});
