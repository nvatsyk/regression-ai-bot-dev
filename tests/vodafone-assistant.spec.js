import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { sleep, navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL = 'https://bit.ly/Vodafone-AI-Demo';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('vodafone-assistant', REPORT_DIR);
const TEST_NAME   = 'Vodafone Cook Islands — Moana AI — Greeting and Services Flow';

test.describe('Vodafone Cook Islands — Moana AI — Regression', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(240000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1-2: Navigate + open chat (label matching is case-insensitive,
    // so "TEXT CHAT" matches the canonical "Text Chat" entry automatically) ──
    // BOT_URL redirects into /frm/ mode, which embeds the live vodafone.co.ck
    // production site (a Wix site with third-party analytics trackers) in a
    // cross-origin iframe — slower and more variable to load than the other
    // bots' lightweight /std/ demo pages, so give it more than the 60s that
    // was timing out on CI.
    console.log('[VODAFONE] Navigating to bot URL...');
    await navigateTo(page, BOT_URL);
    await openChat(page, {
      prefix: '[VODAFONE]',
      reportDir: REPORT_DIR,
      labels: ['Text Chat', 'Chat', 'Start Chat'],
      timeoutMs: 120000,
    });
    await screenshotStage(page, REPORT_DIR, 'vodafone', 'startup');
    console.log('[VODAFONE] Clicked "TEXT CHAT" button');

    // ── Step 3: Wait for + validate greeting ──────────────────────────────────
    console.log('[VODAFONE] Waiting for greeting to load...');
    await waitForGreeting(page, { prefix: '[VODAFONE]', reportDir: REPORT_DIR });
    await screenshotStage(page, REPORT_DIR, 'vodafone', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: '"Hello! I\'m Moana the Vodafone Cook Islands Digital Assistant"', phrases: [
        "I'm Moana the Vodafone Cook Islands Digital Assistant",
        'Moana the Vodafone Cook Islands',
        'Vodafone Cook Islands Digital Assistant',
        'How can I help you today',
        'Moana',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'vodafone', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, 'Step 3: Greeting', greetingFail, '']);
    }
    console.log(`[VODAFONE] ${greetingFail ? '[FAIL]' : '[PASS]'} Greeting validation`);
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4-5: Send "Yes" and validate response ────────────────────────────
    console.log('[VODAFONE] Sending "Yes"...');
    const yesBaseline = await getAllFramesText(page);
    await sendMessage(page, 'Yes');
    await waitForBotResponse(page, {
      prefix: '[VODAFONE]', reportDir: REPORT_DIR,
      baselineText: yesBaseline, sentText: 'Yes', timeoutMs: 45000,
    });
    await sleep(1000);
    await screenshotStage(page, REPORT_DIR, 'vodafone', 'after-yes');

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"Certainly, I can help with Vodafone Cook Islands products and services"', phrases: [
        'Certainly, I can help with Vodafone Cook Islands',
        'Vodafone Cook Islands products and services',
        'mobile plan, internet, Top Up',
        'mobile plan',
        'Top Up',
        'Vodafone Cook Islands',
      ]},
    ]);
    if (step5Fail) {
      await screenshotStage(page, REPORT_DIR, 'vodafone', 'step5-fail');
      logFailure(REPORT_PATH, [TEST_NAME, 'Step 5: Yes response', step5Fail, '']);
    }
    console.log(`[VODAFONE] ${step5Fail ? '[FAIL]' : '[PASS]'} Yes response validation`);
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    // ── Step 6-7: Send "tell me about your services" and validate response ───
    console.log('[VODAFONE] Sending "tell me about your services"...');
    const servicesBaseline = await getAllFramesText(page);
    await sendMessage(page, 'tell me about your services');
    await waitForBotResponse(page, {
      prefix: '[VODAFONE]', reportDir: REPORT_DIR,
      baselineText: servicesBaseline, sentText: 'tell me about your services', timeoutMs: 60000,
    });
    await sleep(1000);
    await screenshotStage(page, REPORT_DIR, 'vodafone', 'after-services');

    const step7Fail = await checkPhraseGroups(page, [
      { label: '"mobile, internet, WiFi, and business connectivity" mention', phrases: [
        'mobile, internet, WiFi', 'business connectivity',
        'mobile, internet', 'internet, WiFi', 'WiFi and business',
        'business and connectivity', 'connectivity solutions',
        'mobile services', 'internet services',
      ]},
      { label: '"E-Moni Mobile Wallet" mention', phrases: ['E-Moni Mobile Wallet', 'E-Moni'] },
    ]);
    if (step7Fail) {
      await screenshotStage(page, REPORT_DIR, 'vodafone', 'step7-fail');
      logFailure(REPORT_PATH, [TEST_NAME, 'Step 7: Services response', step7Fail, '']);
    }
    console.log(`[VODAFONE] ${step7Fail ? '[FAIL]' : '[PASS]'} Services response validation`);
    expect(step7Fail, `Step 7 failed: missing "${step7Fail}"`).toBeNull();

    await screenshotStage(page, REPORT_DIR, 'vodafone', 'complete');
    console.log('[VODAFONE] All steps passed — Vodafone Cook Islands Moana AI regression complete.');
  });
});
