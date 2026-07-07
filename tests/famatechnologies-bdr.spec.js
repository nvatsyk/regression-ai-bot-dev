import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { sleep, navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGORyTmV31QhynI7QflIA1MkB-29FLbACzL4F4oGmk9vhh4DSrCTSc-2Jgqb2P2V8G3-kgZqBPGBblsVCwA0jCmquFWAM23NqxpQUvfgbfya1dqB0ypUzWD4-kOAWWOgzIuEaoAqlT4VskIqi_P_dWMZ3-ItxhMKsP2-C_kC2Trxiu0TAhLE1TWBk0HlGlzEwBAuQxBCxqAC1AA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('famatechnologies-bdr', REPORT_DIR);
const BUG_TITLE   = 'Famatechnologies BDR name capture flow';
const TEST_NAME   = 'Famatechnologies BDR name capture flow';

test.describe('Famatechnologies BDR — Name Capture Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await navigateTo(page, BOT_URL);
    await screenshotStage(page, REPORT_DIR, 'fama', 'startup');

    // Dismiss any "Got it" banner before opening chat
    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    await openChat(page, {
      prefix: '[FAMA]',
      reportDir: REPORT_DIR,
      labels: ["Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'],
    });

    // ── Step 3: Wait for + validate bot greeting ─────────────────────────────
    console.log('[FAMA] Waiting for bot greeting...');
    await waitForGreeting(page, { prefix: '[FAMA]', reportDir: REPORT_DIR, timeoutMs: 70000 });
    await screenshotStage(page, REPORT_DIR, 'fama', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'greeting acknowledgement', phrases: [
        'Famatechnologies', 'famatechnologies', 'Noura', 'noura',
        'first and last name', 'first name', 'last name', 'your name', 'name',
        'keyboard', 'Hello', 'hello', 'Welcome', 'welcome', 'help', 'assist',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'fama', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, '']);
    }
    expect(greetingFail, 'Step 3: bot did not send a greeting').toBeNull();

    // ── Step 4-5: Send "Natali Test" and validate any bot response ───────────
    console.log('[FAMA] Greeting confirmed — sending "Natali Test"...');
    const nameBaseline = await getAllFramesText(page);
    await sendMessage(page, 'Natali Test');
    console.log('[FAMA] User message sent');
    await waitForBotResponse(page, {
      prefix: '[FAMA]', reportDir: REPORT_DIR,
      baselineText: nameBaseline, sentText: 'Natali Test', timeoutMs: 70000,
    });
    await screenshotStage(page, REPORT_DIR, 'fama', 'after-name');

    const step5Fail = await checkPhraseGroups(page, [
      { label: 'name acknowledgement', phrases: [
        'Thank', 'thank', 'phone', 'Natali', 'natali',
        'great', 'Great', 'please', 'Please',
        'contact', 'number', 'mobile', 'share', 'provide',
        'enter', 'next', 'continue',
      ]},
    ]);
    if (step5Fail) {
      await screenshotStage(page, REPORT_DIR, 'fama', 'name-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Name response', step5Fail, '']);
    }
    expect(step5Fail, 'Step 5: bot gave no expected response after sending name').toBeNull();

    await screenshotStage(page, REPORT_DIR, 'fama', 'complete');
    console.log('[FAMA] Test complete — greeting and name response verified.');
  });
});
