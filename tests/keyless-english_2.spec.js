import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G4UAKGTqHPlzBth8O49KPVnI3YuRTJOMEDWbUAK9Yduh5PWal-K-IN63Klq6_9JBKp5qrESF44g4Jy2jrTdyMApCl_mGtnAAVRrCPHCMZUFmP8dYFhtGkS6oQlLZBCUMKZKc5WXy3CkKfg';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('keyless-english_2', REPORT_DIR);
const BUG_TITLE   = 'Keyless English greeting and unlock reply flow';
const TEST_NAME   = 'Keyless English greeting and unlock reply flow';

test.describe('Keyless English — Greeting and Unlock Reply Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[KE2] Navigating to Keyless English bot...');
    await navigateTo(page, BOT_URL);
    await screenshotStage(page, REPORT_DIR, 'ke2', 'startup');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    await openChat(page, { prefix: '[KE2]', reportDir: REPORT_DIR });

    // ── Step 3: Wait for + validate bot greeting ─────────────────────────────
    await waitForGreeting(page, { prefix: '[KE2]', reportDir: REPORT_DIR, timeoutMs: 70000 });
    await screenshotStage(page, REPORT_DIR, 'ke2', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'greeting acknowledgement', phrases: [
        'help', 'Hello', 'Hi', 'welcome', 'assist', 'support', 'UXE', 'Ahmed', 'Keyless', 'chat', 'today', 'can I',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'ke2', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, '']);
    }
    expect(greetingFail, 'Step 3: bot did not send a greeting').toBeNull();

    // ── Step 4-5: Send "to unlock the key" and validate reply ────────────────
    const unlockBaseline = await getAllFramesText(page);
    await sendMessage(page, 'to unlock the key');
    console.log('[KE2] User message sent — waiting for any bot response.');
    await waitForBotResponse(page, {
      prefix: '[KE2]', reportDir: REPORT_DIR,
      baselineText: unlockBaseline, sentText: 'to unlock the key', timeoutMs: 60000,
    });
    await screenshotStage(page, REPORT_DIR, 'ke2', 'after-unlock-msg');

    const replyFail = await checkPhraseGroups(page, [
      { label: 'unlock reply', phrases: [
        'unlock', 'sort', 'right now', 'currently', 'trying',
        'mobile app', 'mobile', 'passcode', 'RFID', 'rfid',
        'access card', 'keypad', 'method', 'How are you',
        'We can', 'can help', 'let me', 'please', 'could you',
      ]},
    ]);
    if (replyFail) {
      await screenshotStage(page, REPORT_DIR, 'ke2', 'reply-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Bot reply after "to unlock the key"', replyFail, '']);
    }
    expect(replyFail, 'Step 5: bot did not reply after "to unlock the key"').toBeNull();

    await screenshotStage(page, REPORT_DIR, 'ke2', 'complete');
    console.log('[KE2] Test complete — Keyless greeting and unlock reply verified.');
  });
});
