import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForAnyNewOccurrence, sendMessage, getAllFramesText, captureBaselines,
} from './helpers/browser-utils.js';

const BOT_URL = 'https://sdemo.nextlevel.ai/Monarch-Roofs-Demo';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Monarch Roofs outreach greeting and multi-turn flow';
const TEST_NAME   = 'Monarch Roofs outreach greeting and multi-turn flow';

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

test.describe('Monarch Roofs Outreach — Multi-Turn Conversation Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(300000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[MONARCH] Navigating to Monarch Roofs Outreach bot...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'monarch-startup.png') }).catch(() => {});
    await checkAndHandleCloudflare(page, '[MONARCH]', REPORT_DIR);
    console.log('[MONARCH] Page loaded.');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    console.log('[MONARCH] Opening chat widget (up to 60s)...');
    const chatOpened = await openChatWidget(page, {
      prefix: '[MONARCH]',
      failScreenshotPath: join(REPORT_DIR, 'monarch-open-btn-not-found.png'),
      timeoutMs: 60000,
    });
    if (!chatOpened) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      logFailure('Step 2: Chat button', 'no chat button found', vis.join(', '));
      throw new Error('[MONARCH] Chat button not found after 60s. Visible: ' + vis.join(', '));
    }
    console.log('[MONARCH] Chat opened — waiting for panel to settle.');
    await sleep(2000);

    // ── Step 3: Wait for first bot greeting ───────────────────────────────────
    const GREETING_PHRASES = [
      'Good morning', 'Good afternoon', 'Good evening', 'Good day',
      'is this', 'Is this', 'speaking', 'Speaking',
      'Hello', 'Hi', 'Hey',
      'Christopher', 'certificate', 'Certificate',
      'calling', 'Calling', 'reaching out',
    ];
    const greetingBaselines = await captureBaselines(page, GREETING_PHRASES);

    console.log('[MONARCH] Waiting up to 60s for first bot greeting...');
    const matchedGreeting = await waitForAnyNewOccurrence(page, GREETING_PHRASES, greetingBaselines, 60000);

    await sleep(1000);
    const actualGreeting = await getAllFramesText(page);
    console.log(`[MONARCH] First greeting detected via phrase: "${matchedGreeting}"`);
    await page.screenshot({ path: join(REPORT_DIR, 'monarch-greeting.png') }).catch(() => {});

    if (!matchedGreeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'monarch-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: First greeting', 'no greeting received', actualGreeting);
    }
    expect(matchedGreeting, 'Step 3: bot did not send a greeting').not.toBeNull();
    console.log('[MONARCH] First greeting validated. Sending "Yes" now.');

    // ── Step 4: Send "Yes" ────────────────────────────────────────────────────
    const STEP2_PHRASES = [
      'How are you', 'how are you', 'How are you today', 'how are you today',
      'doing today', 'Doing today', 'feeling today',
      'hope you', 'Hope you', 'trust you',
      'today', 'morning', 'afternoon', 'evening',
    ];
    const step2Baselines = await captureBaselines(page, STEP2_PHRASES);

    console.log('[MONARCH] Sending: "Yes"');
    await sendMessage(page, 'Yes');

    // ── Step 5: Wait for second bot message ───────────────────────────────────
    const matchedStep2 = await waitForAnyNewOccurrence(page, STEP2_PHRASES, step2Baselines, 60000);

    await sleep(1000);
    const actualStep2 = await getAllFramesText(page);
    console.log(`[MONARCH] Second bot message detected via phrase: "${matchedStep2}"`);
    await page.screenshot({ path: join(REPORT_DIR, 'monarch-after-yes.png') }).catch(() => {});

    if (!matchedStep2) {
      await page.screenshot({ path: join(REPORT_DIR, 'monarch-step2-fail.png') }).catch(() => {});
      logFailure('Step 5: Response after "Yes"', 'no response received', actualStep2);
    }
    expect(matchedStep2, 'Step 5: bot did not respond after "Yes"').not.toBeNull();
    console.log('[MONARCH] Second bot message validated. Sending "good" now.');

    // ── Step 6: Send "good" ───────────────────────────────────────────────────
    const FINAL_PHRASES = [
      'Glad to hear', 'glad to hear', 'Great to hear', 'great to hear',
      'Good to hear', 'good to hear', 'Happy to hear', 'happy to hear',
      'sales call', 'not a sales', 'Energy Performance', 'energy performance',
      'Certificate', 'certificate', 'EPC', 'expired',
      'renewing', 'Renewing', 'renewal', 'Renewal',
      'roofing', 'Roofing', 'roof', 'Roof',
      'Perfect', 'perfect', 'Wonderful', 'wonderful', 'Fantastic', 'fantastic',
      'Amazing', 'amazing', 'Awesome', 'awesome', 'Excellent', 'excellent',
      'calling', 'Calling', 'calling because', 'I am calling', "I'm calling",
      'reaching out', 'Reaching out', 'reason I', 'reason for',
      'because', 'Because', 'regarding', 'Regarding',
      'have a chance', 'Had a chance', 'look into', 'looked into',
      'That is', "That's", 'this is', "This is", "This isn",
      'help you', 'assist', 'can I', 'I can',
    ];
    const finalBaselines = await captureBaselines(page, FINAL_PHRASES);

    console.log('[MONARCH] Sending: "good"');
    await sendMessage(page, 'good');

    // ── Step 7: Validate final bot response ───────────────────────────────────
    const matchedFinal = await waitForAnyNewOccurrence(page, FINAL_PHRASES, finalBaselines, 90000);

    await sleep(1000);
    const actualFinal = await getAllFramesText(page);
    console.log(`[MONARCH] Final response detected via phrase: "${matchedFinal}"`);

    if (!matchedFinal) {
      const allText = await page.evaluate(() =>
        Array.from(document.querySelectorAll('*'))
          .map(el => el.innerText || el.textContent || '')
          .filter(t => t.trim().length > 10)
          .slice(0, 30)
          .join(' | ')
      ).catch(() => '');
      console.log('[MONARCH] DEBUG — visible page text nodes:', allText.slice(0, 600));
    }

    await page.screenshot({ path: join(REPORT_DIR, 'monarch-after-good.png') }).catch(() => {});

    if (!matchedFinal) {
      await page.screenshot({ path: join(REPORT_DIR, 'monarch-final-fail.png') }).catch(() => {});
      logFailure('Step 7: Final response after "good"', 'no response received', actualFinal);
    }
    expect(matchedFinal, 'Step 7: bot did not respond after "good"').not.toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'monarch-complete.png') }).catch(() => {});
    console.log('[MONARCH] Test complete — Monarch Roofs outreach multi-turn flow verified.');
  });
});
