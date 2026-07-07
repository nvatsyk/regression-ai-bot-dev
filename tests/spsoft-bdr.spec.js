import { test, expect } from '@playwright/test';
import { sleep, navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74ACORyTmV70SWWHX5GaAtEOjlg_62oBVZgZW2BeKC5jeHQ0e5lW6g9I7Ntgk-VPBgXGa3ZUGYR0mYOgzZDZqnFYcN0HIRi-m5D5XBE-vSNPx0Zrlm5FeGOOLAOdngLMXwm4K4h1JA9JXsDMsTF_7vB2nf880kMUT6cN8XMBo5uguMprOuYlCXxKiWyDk-pkmxRtuwoVlt5W5BYtAI';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('spsoft-bdr', REPORT_DIR);
const BUG_TITLE   = 'SPsoft BDR services flow';
const TEST_NAME   = 'SPsoft BDR services flow';

test.describe('SPsoft BDR — Services Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(240000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await navigateTo(page, BOT_URL);
    await screenshotStage(page, REPORT_DIR, 'spsoft', 'startup');

    // Dismiss any "Got it" banner
    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    await openChat(page, {
      prefix: '[SPSOFT]',
      reportDir: REPORT_DIR,
      labels: ["Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'],
    });
    console.log('[SPSOFT] Clicked chat button — waiting for greeting.');

    // ── Step 3: Wait for + validate bot greeting ─────────────────────────────
    await waitForGreeting(page, { prefix: '[SPSOFT]', reportDir: REPORT_DIR, timeoutMs: 70000 });
    await screenshotStage(page, REPORT_DIR, 'spsoft', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'greeting acknowledgement', phrases: [
        'Hello', 'Hi', 'welcome', 'name', 'your name', 'What is your name',
        'help', 'assist', 'SPsoft', 'spsoft', 'Jessica', 'jessica', 'today',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'spsoft', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, '']);
    }
    expect(greetingFail, 'Step 3: bot did not send a greeting').toBeNull();

    // ── Step 4-5: Send "Natali" and validate any bot response ────────────────
    const nameBaseline = await getAllFramesText(page);
    await sendMessage(page, 'Natali');
    console.log('[SPSOFT] User message sent');
    await waitForBotResponse(page, {
      prefix: '[SPSOFT]', reportDir: REPORT_DIR,
      baselineText: nameBaseline, sentText: 'Natali', timeoutMs: 70000,
    });
    await screenshotStage(page, REPORT_DIR, 'spsoft', 'after-name');

    const step5Fail = await checkPhraseGroups(page, [
      { label: 'name acknowledgement', phrases: [
        'Great', 'great', 'Nice', 'nice', 'Thanks', 'thank',
        'Natali', 'natali', 'meet', 'How can I help', 'how can I assist',
        'What can I help', 'SPsoft', 'services', 'help you', 'assist you',
      ]},
    ]);
    if (step5Fail) {
      await screenshotStage(page, REPORT_DIR, 'spsoft', 'step5-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Name acknowledgement', step5Fail, '']);
    }
    expect(step5Fail, 'Step 5: bot gave no response after sending name').toBeNull();

    // ── Step 6-7: Send "tell me about your services" and validate response ───
    const servicesBaseline = await getAllFramesText(page);
    await sendMessage(page, 'tell me about your services');
    console.log('[SPSOFT] Sent "tell me about your services" — waiting for response.');
    await waitForBotResponse(page, {
      prefix: '[SPSOFT]', reportDir: REPORT_DIR,
      baselineText: servicesBaseline, sentText: 'tell me about your services', timeoutMs: 70000,
    });
    await screenshotStage(page, REPORT_DIR, 'spsoft', 'after-services');

    const step7Fail = await checkPhraseGroups(page, [
      { label: 'services response', phrases: [
        'software', 'Software', 'development', 'Development', 'services', 'Services',
        'solution', 'Solution', 'technology', 'Technology', 'web', 'Web',
        'mobile', 'Mobile', 'cloud', 'Cloud', 'custom', 'Custom', 'AI', 'automation',
      ]},
    ]);
    if (step7Fail) {
      await screenshotStage(page, REPORT_DIR, 'spsoft', 'services-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 7: Services response', step7Fail, '']);
    }
    expect(step7Fail, 'Step 7: bot gave no response to services question').toBeNull();

    await screenshotStage(page, REPORT_DIR, 'spsoft', 'complete');
    console.log('[SPSOFT] Test complete — services response verified.');
  });
});
