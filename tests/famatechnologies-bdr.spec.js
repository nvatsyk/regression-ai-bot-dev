import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForBotGreeting, waitForAnyNewOccurrence, sendMessage,
} from './helpers/browser-utils.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGORyTmV31QhynI7QflIA1MkB-29FLbACzL4F4oGmk9vhh4DSrCTSc-2Jgqb2P2V8G3-kgZqBPGBblsVCwA0jCmquFWAM23NqxpQUvfgbfya1dqB0ypUzWD4-kOAWWOgzIuEaoAqlT4VskIqi_P_dWMZ3-ItxhMKsP2-C_kC2Trxiu0TAhLE1TWBk0HlGlzEwBAuQxBCxqAC1AA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Famatechnologies BDR name capture flow';
const TEST_NAME   = 'Famatechnologies BDR name capture flow';

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

test.describe('Famatechnologies BDR — Name Capture Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await navigateTo(page, BOT_URL);
    await checkAndHandleCloudflare(page, '[FAMA]', REPORT_DIR);
    await page.screenshot({ path: join(REPORT_DIR, 'fama-startup.png') }).catch(() => {});

    // Dismiss any "Got it" banner before capturing baselines
    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // ── Step 2: Capture baselines, open chat ──────────────────────────────────
    const greetingPhrases = [
      'Famatechnologies', 'famatechnologies', 'Noura', 'noura',
      'first and last name', 'first name', 'last name', 'your name', 'name',
      'keyboard', 'Hello', 'hello', 'Welcome', 'welcome', 'help', 'assist',
    ];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const chatOpened = await openChatWidget(page, {
      prefix: '[FAMA]',
      labels: ["Let's chat", "Let's Chat", "Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'],
      failScreenshotPath: join(REPORT_DIR, 'fama-open-btn-not-found.png'),
    });
    if (!chatOpened) {
      await page.screenshot({ path: join(REPORT_DIR, 'fama-open-btn-not-found.png') }).catch(() => {});
      throw new Error('[FAMA] Chat button not found');
    }

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    console.log('[FAMA] Waiting for bot greeting...');
    const greeting = await waitForBotGreeting(page, greetingPhrases, greetingBase, 70000);
    if (!greeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'fama-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', '');
    }
    expect(greeting, 'Step 3: bot did not send a greeting').toBeTruthy();
    console.log('[TEST] Greeting:', greeting);
    await page.screenshot({ path: join(REPORT_DIR, 'fama-greeting.png') }).catch(() => {});

    // ── Step 4: Send "Natali Test" ────────────────────────────────────────────
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
    const step5Trigger = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 70000);
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
