import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { sleep, navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AOORyTmV30SWW43SE9lMA1skB-29FLbCyNGsLxANNJ7fDDwmll5bZufaEoKn9TxmfxpvRQE1DHjAbXTAQsL5FQc22PIRmek5NZxxRs77xZ6C1A6VTrpzB9MnBCm6BiT8j5q8BrnD6lK0NVnCU_78bU_8OfyGOcJj1500xbtjW1VYlFwhYtKJqhJYUEGiNSAINoiu74LayeB0t';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('merkel-ltd', REPORT_DIR);
const BUG_TITLE   = 'Merkel LTD Bengali working hours flow';
const TEST_NAME   = 'Merkel LTD Bengali working hours flow';

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
    await screenshotStage(page, REPORT_DIR, 'merkel', 'startup');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    await openChat(page, { prefix: '[MERKEL]', reportDir: REPORT_DIR });
    await sleep(2000);

    // ── Step 3: Wait for + validate bot greeting ─────────────────────────────
    console.log('[MERKEL] Waiting for bot greeting...');
    await waitForGreeting(page, { prefix: '[MERKEL]', reportDir: REPORT_DIR, timeoutMs: 70000 });
    await screenshotStage(page, REPORT_DIR, 'merkel', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'greeting mention', phrases: GREETING_PHRASES },
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'merkel', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, '']);
    }
    expect(greetingFail, 'Step 3: bot did not send a greeting').toBeNull();

    // ── Step 4-5: Send Bengali working-hours question and validate response ──
    const USER_MSG = 'আপনার কাজের সময়সূচী কী?';
    console.log(`[MERKEL] Sending: "${USER_MSG}"`);
    const questionBaseline = await getAllFramesText(page);
    await sendMessage(page, USER_MSG);
    console.log('[MERKEL] User message sent');
    await waitForBotResponse(page, {
      prefix: '[MERKEL]', reportDir: REPORT_DIR,
      baselineText: questionBaseline, sentText: USER_MSG, timeoutMs: 70000,
    });
    await screenshotStage(page, REPORT_DIR, 'merkel', 'cafe-response');

    const responseFail = await checkPhraseGroups(page, [
      { label: 'working-hours response', phrases: RESPONSE_PHRASES },
    ]);
    if (responseFail) {
      await screenshotStage(page, REPORT_DIR, 'merkel', 'cafe-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Response', responseFail, '']);
    }
    expect(responseFail, 'Step 5: bot did not respond to Bengali message').toBeNull();

    await screenshotStage(page, REPORT_DIR, 'merkel', 'complete');
    console.log('[MERKEL] Test complete — Bengali greeting and working-hours response verified.');
  });
});
