import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGORyTmV30UmJ5Pg7Qlsg0skBa-tW1AIrwKwtl8ASTE-2hwuaLGkUqT4zJ2Q0tf8p49v8pzVGTYw8oFqUQRkBPZQoqOmWhRCm59RE5Agv-safhtaOUTrlyhl03zxYwS3Q4TMCew2ggvQpWhuQIMr_342ufoc_F0cQZv1549Ab2HZzVFmSGFkmrsQJRFAlnphipLQyisPyNsdyCloA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('chronilogix-bdr-simple', REPORT_DIR);
const BUG_TITLE   = 'Chronilogix BDR mental health personal support flow';
const TEST_NAME   = 'Chronilogix BDR mental health personal support flow';

test.describe('Chronilogix BDR — Mental Health Personal Support Flow (Simple)', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await navigateTo(page, BOT_URL);
    await screenshotStage(page, REPORT_DIR, 'chron-s', 'startup');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    await openChat(page, { prefix: '[CHRON-S]', reportDir: REPORT_DIR });

    // ── Step 3: Wait for + validate bot greeting ─────────────────────────────
    await waitForGreeting(page, { prefix: '[CHRON-S]', reportDir: REPORT_DIR, timeoutMs: 70000 });
    await screenshotStage(page, REPORT_DIR, 'chron-s', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'greeting acknowledgement', phrases: [
        'Hello', 'Hi', 'welcome', 'name', 'your name', 'help', 'assist',
        'Chronilogix', 'Roni', 'support', 'today', 'How can',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'chron-s', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, '']);
    }
    expect(greetingFail, 'Step 3: bot did not send a greeting').toBeNull();

    // ── Step 4-5: Send "Natali" and validate any bot response ────────────────
    const nameBaseline = await getAllFramesText(page);
    await sendMessage(page, 'Natali');
    console.log('[CHRON-S] User message sent');
    await waitForBotResponse(page, {
      prefix: '[CHRON-S]', reportDir: REPORT_DIR,
      baselineText: nameBaseline, sentText: 'Natali', timeoutMs: 60000,
    });
    await screenshotStage(page, REPORT_DIR, 'chron-s', 'after-name');

    const step5Fail = await checkPhraseGroups(page, [
      { label: 'name response', phrases: [
        'Great', 'great', 'Nice', 'nice', 'Hello', 'Hi', 'thanks', 'Thank',
        'Natali', 'natali', 'name', 'help', 'How', 'What', 'please', 'could',
        'Chronilogix', 'regarding', 'assist', 'meet', 'welcome',
      ]},
    ]);
    if (step5Fail) {
      await screenshotStage(page, REPORT_DIR, 'chron-s', 'step5-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Name response', step5Fail, '']);
    }
    expect(step5Fail, 'Step 5: bot gave no response after sending name').toBeNull();

    // ── Step 6: Send "Mental Health" — test passes after this send ───────────
    await sendMessage(page, 'Mental Health');
    await screenshotStage(page, REPORT_DIR, 'chron-s', 'after-mental-health');

    // ── Step 7: Send "Myself" — test passes after this send ──────────────────
    await sendMessage(page, 'Myself');
    await screenshotStage(page, REPORT_DIR, 'chron-s', 'complete');
    console.log('[CHRON-S] Test complete — "Myself" sent successfully.');
  });
});
