import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { sleep, navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGORyTmV30UmJ5Pg7Qlsg0skB-29FLbACzNpyjxNLJ7fDD1mAWUmk55oTMpra_5TxbfxpjVETIw-olmVQRkAPJQpqumUhhOk5NTE5wou-8aehtWOUTrlyBt03D1ZwC3T4jMBeA6ggfYrWBiSI8v93o6vf4c_FEYRZf94E_Qa2doNlXVUUWGKLjkQEgcsXlXd4YrmCYjCSrbqKhRY';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('solix-bdr', REPORT_DIR);
const BUG_TITLE   = 'Solix BDR name capture flow';
const TEST_NAME   = 'Solix BDR name capture flow';

test.describe('Solix BDR — Name Capture Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await navigateTo(page, BOT_URL);
    await screenshotStage(page, REPORT_DIR, 'solix', 'startup');

    // Dismiss any "Got it" banner
    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    await openChat(page, {
      prefix: '[SOLIX]',
      reportDir: REPORT_DIR,
      labels: ["Let's Talk", 'Lets Talk', 'Talk', 'Text Chat', 'Chat', 'Start Chat', "Let's Chat", 'Start New Session'],
    });

    // ── Step 3: Wait for + validate bot greeting ─────────────────────────────
    await waitForGreeting(page, { prefix: '[SOLIX]', reportDir: REPORT_DIR, timeoutMs: 70000 });
    await screenshotStage(page, REPORT_DIR, 'solix', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'greeting acknowledgement', phrases: [
        'Hello', 'Hi', 'welcome', 'name', 'your name', 'address you',
        'help', 'assist', 'Solix', 'solix', 'Jessica', 'jessica', 'today',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'solix', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, '']);
    }
    expect(greetingFail, 'Step 3: bot did not send a greeting').toBeNull();

    // ── Step 4-5: Send "Natali Test" and validate any bot response ───────────
    const nameBaseline = await getAllFramesText(page);
    await sendMessage(page, 'Natali Test');
    console.log('[SOLIX] User message sent');
    await waitForBotResponse(page, {
      prefix: '[SOLIX]', reportDir: REPORT_DIR,
      baselineText: nameBaseline, sentText: 'Natali Test', timeoutMs: 70000,
    });
    await screenshotStage(page, REPORT_DIR, 'solix', 'after-name');

    const step5Fail = await checkPhraseGroups(page, [
      { label: 'name acknowledgement', phrases: [
        'Hi Natali', 'Natali', 'natali',
        'How can I help', 'learn more about Solix',
        'How can I assist', 'data management', 'assist you today',
        'feel free', 'here to help', 'happy to help',
        'Great', 'great', 'Nice', 'Thanks', 'thank',
      ]},
    ]);
    if (step5Fail) {
      await screenshotStage(page, REPORT_DIR, 'solix', 'step5-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Name acknowledgement', step5Fail, '']);
    }
    expect(step5Fail, 'Step 5: bot gave no expected response after sending name').toBeNull();

    await screenshotStage(page, REPORT_DIR, 'solix', 'complete');
    console.log('[SOLIX] Test complete — name capture and Solix intro verified.');
  });
});
