import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { sleep, navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL = 'https://nextlevel.ai/';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('nextlevel-ai-bdr', REPORT_DIR);
const BUG_TITLE   = 'Nextlevel.ai BDR greeting and name flow';
const TEST_NAME   = 'Nextlevel.ai BDR greeting and name flow';

// nextlevel.ai has iframes — textbox search spans all frames, so this can't
// use the generic response-helper.sendMessage (main-frame only).
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
    await screenshotStage(page, REPORT_DIR, 'nl', 'startup');

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

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    await openChat(page, {
      prefix: '[NL-BDR]',
      reportDir: REPORT_DIR,
      labels: ["Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'],
    });
    console.log('[NL-BDR] Clicked chat button — waiting for greeting.');

    // ── Step 3: Wait for + validate bot greeting ─────────────────────────────
    await waitForGreeting(page, { prefix: '[NL-BDR]', reportDir: REPORT_DIR, timeoutMs: 70000 });
    await screenshotStage(page, REPORT_DIR, 'nl', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'greeting acknowledgement', phrases: [
        'Hello', 'Hi', 'welcome', 'name', 'your name', 'may I have your name',
        'help', 'assist', 'NextLevel', 'nextlevel', 'Jessica', 'jessica', 'today',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'nl', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, '']);
    }
    expect(greetingFail, 'Step 3: bot did not send a greeting').toBeNull();

    // ── Step 4-5: Send "Natali" and validate bot replied ─────────────────────
    const nameBaseline = await getAllFramesText(page);
    await sendMessageNL(page, 'Natali');
    console.log('[NL-BDR] User message sent');
    await waitForBotResponse(page, {
      prefix: '[NL-BDR]', reportDir: REPORT_DIR,
      baselineText: nameBaseline, sentText: 'Natali', timeoutMs: 70000,
    });
    await screenshotStage(page, REPORT_DIR, 'nl', 'after-name');

    const replyFail = await checkPhraseGroups(page, [
      { label: 'name reply', phrases: [
        'Natali', 'natali',
        'meet you', 'meet', 'nice to meet', 'great to meet', 'pleasure to meet',
        'phone', 'number', 'email', 'address',
        'Thank you', 'thank you', 'Thanks', 'thanks',
        'please', 'provide', 'could you', 'can you', 'would you',
        'help', 'assist', 'question', 'interested',
      ]},
    ]);
    if (replyFail) {
      await screenshotStage(page, REPORT_DIR, 'nl', 'name-reply-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Bot reply after name', replyFail, '']);
    }
    expect(replyFail, 'Step 5: bot did not reply after receiving "Natali"').toBeNull();

    await screenshotStage(page, REPORT_DIR, 'nl', 'complete');
    console.log('[NL-BDR] Bot replied after name — test complete.');
  });
});
