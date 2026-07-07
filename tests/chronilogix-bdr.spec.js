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
const REPORT_PATH = reportPathFor('chronilogix-bdr', REPORT_DIR);
const BUG_TITLE   = 'Chronilogix BDR mental health personal support flow';
const TEST_NAME   = 'Chronilogix BDR mental health personal support flow';

test.describe('Chronilogix BDR — Mental Health Personal Support Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: greeting + 3 bot responses + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1-2: Navigate + open chat ────────────────────────────────────────
    await navigateTo(page, BOT_URL);
    await screenshotStage(page, REPORT_DIR, 'chron', 'startup');
    await openChat(page, {
      prefix: '[CHRON]',
      reportDir: REPORT_DIR,
      labels: ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", 'Let’s Chat'],
    });

    // ── Step 3: Wait for and validate greeting ────────────────────────────────
    await waitForGreeting(page, { prefix: '[CHRON]', reportDir: REPORT_DIR });
    await screenshotStage(page, REPORT_DIR, 'chron', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'Chronilogix mention', phrases: [
        'Chronilogix AI representative', 'Chronilogix AI', 'AI representative',
        'Chronilogix', 'chronilogix',
      ]},
      { label: '"Roni" introduction', phrases: ['Roni'] },
      { label: '"What is your name" prompt', phrases: [
        'What is your name', 'your name', 'name?',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'chron', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, '']);
    }
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4-5: Send "Natali" and validate name acknowledgement ─────────────
    const nameBaseline = await getAllFramesText(page);
    await sendMessage(page, 'Natali');
    await waitForBotResponse(page, {
      prefix: '[CHRON]', reportDir: REPORT_DIR,
      baselineText: nameBaseline, sentText: 'Natali', timeoutMs: 60000,
    });
    await screenshotStage(page, REPORT_DIR, 'chron', 'after-name');

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"Great to meet you" acknowledgement', phrases: [
        'Great to meet you', 'great to meet', 'Nice to meet', 'nice to meet', 'nice meeting',
      ]},
      { label: '"Natali" echo', phrases: ['Natali', 'natali'] },
      { label: '"What can I help you with" question', phrases: [
        'What can I help you with regarding Chronilogix',
        'help you with regarding Chronilogix',
        'What can I help you with',
        'how can I help', 'How can I help',
      ]},
    ]);
    if (step5Fail) {
      await screenshotStage(page, REPORT_DIR, 'chron', 'step5-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Name acknowledgement', step5Fail, '']);
    }
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    // ── Step 6: Send "Mental Health" — test passes after this send ───────────
    await sendMessage(page, 'Mental Health');
    await screenshotStage(page, REPORT_DIR, 'chron', 'after-mental-health');

    // ── Step 7: Send "Myself" — test passes after this send ──────────────────
    await sendMessage(page, 'Myself');
    await screenshotStage(page, REPORT_DIR, 'chron', 'complete');
    console.log('[CHRON] Test complete — "Myself" sent successfully.');
  });
});
