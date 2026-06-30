import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForBotGreeting, waitForAnyNewOccurrence,
} from './helpers/browser-utils.js';

const BOT_URL = 'https://nextlevel.ai/';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Nextlevel.ai BDR greeting and name flow';
const TEST_NAME   = 'Nextlevel.ai BDR greeting and name flow';

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

// nextlevel.ai has iframes — textbox search spans all frames
async function sendMessageNL(page, text, { inputWaitMs = 70000 } = {}) {
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

test.describe('Nextlevel.ai BDR — Greeting and Name Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[NL-BDR] Navigating to nextlevel.ai...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);
    await page.screenshot({ path: join(REPORT_DIR, 'nl-startup.png') }).catch(() => {});
    await checkAndHandleCloudflare(page, '[NL-BDR]', REPORT_DIR);

    // Dismiss cookie consent / got-it banners
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

    // ── Step 2: Capture baselines, open chat ──────────────────────────────────
    const greetingPhrases = ['Hello', 'Hi', 'welcome', 'name', 'your name', 'may I have your name', 'help', 'assist', 'NextLevel', 'nextlevel', 'Jessica', 'jessica', 'today'];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const chatOpened = await openChatWidget(page, {
      prefix: '[NL-BDR]',
      labels: ["Let's Chat", "Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'],
      failScreenshotPath: join(REPORT_DIR, 'nl-open-btn-not-found.png'),
    });
    if (!chatOpened) {
      logFailure('Step 2: Chat button', 'no chat button found', '');
      throw new Error('[NL-BDR] Chat button not found after 70s');
    }
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

    await sendMessageNL(page, 'Natali');
    console.log('[TEST] User message sent');

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
