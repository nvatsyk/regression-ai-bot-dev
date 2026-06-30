import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForAnyNewOccurrence, sendMessage, getAllFramesText, captureBaselines,
} from './helpers/browser-utils.js';

const BOT_URL = 'https://bit.ly/Novo-Nordisk-QnA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Novo Nordisk Q&A Agent greeting and GLP-1 response flow';
const TEST_NAME   = 'Novo Nordisk Q&A Agent greeting and GLP-1 response flow';

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

test.describe('Novo Nordisk Q&A Agent — Greeting and GLP-1 Response Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[NOVO] Navigating to Novo Nordisk Q&A Agent...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'novo-startup.png') }).catch(() => {});
    await checkAndHandleCloudflare(page, '[NOVO]', REPORT_DIR);

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    console.log('[NOVO] Opening chat widget (up to 60s)...');
    const chatOpened = await openChatWidget(page, {
      prefix: '[NOVO]',
      failScreenshotPath: join(REPORT_DIR, 'novo-open-btn-not-found.png'),
      timeoutMs: 60000,
    });
    if (!chatOpened) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      logFailure('Step 2: Chat button', 'no chat button found', vis.join(', '));
      throw new Error('[NOVO] Chat button not found after 60s. Visible: ' + vis.join(', '));
    }
    console.log('[NOVO] Chat opened — waiting for panel to settle.');

    await sleep(2000);

    // ── Step 3: Wait for greeting ─────────────────────────────────────────────
    const GREETING_PHRASES = [
      'Nour', 'health coach', 'GLP-1', 'GLP1', 'medical advice',
      'not a doctor', 'help you today', 'How can I help',
      'educational', 'therapy',
    ];
    const greetingBaselines = await captureBaselines(page, GREETING_PHRASES);

    console.log('[NOVO] Waiting up to 60s for bot greeting...');
    const matchedGreetingPhrase = await waitForAnyNewOccurrence(page, GREETING_PHRASES, greetingBaselines, 60000);

    await sleep(1000);
    const actualGreeting = await getAllFramesText(page);
    console.log(`[NOVO] Greeting detected via phrase: "${matchedGreetingPhrase}"`);
    console.log(`[NOVO] Actual greeting text: ${actualGreeting.slice(0, 500)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'novo-greeting.png') }).catch(() => {});

    if (!matchedGreetingPhrase) {
      await page.screenshot({ path: join(REPORT_DIR, 'novo-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', actualGreeting);
    }
    expect(matchedGreetingPhrase, 'Step 3: bot did not send a greeting').not.toBeNull();
    console.log('[NOVO] Greeting validated. Sending user message now.');

    // ── Step 4: Send "explain GLP-1 therapy" ─────────────────────────────────
    const RESPONSE_PHRASES = [
      'GLP-1', 'GLP1', 'therapy', 'hormone', 'hunger', 'medicine',
      'insulin', 'blood sugar', 'weight', 'reduce', 'body makes',
      'glucagon', 'appetite', 'type 2', 'diabetes',
    ];
    const responseBaselines = await captureBaselines(page, RESPONSE_PHRASES);

    console.log('[NOVO] Sending: "explain GLP-1 therapy"');
    await sendMessage(page, 'explain GLP-1 therapy');
    console.log('[NOVO] Message sent — waiting up to 60s for bot response.');

    // ── Step 5: Validate bot response ─────────────────────────────────────────
    const matchedResponsePhrase = await waitForAnyNewOccurrence(page, RESPONSE_PHRASES, responseBaselines, 60000);

    await sleep(1000);
    const actualResponse = await getAllFramesText(page);
    console.log(`[NOVO] Response detected via phrase: "${matchedResponsePhrase}"`);
    console.log(`[NOVO] Actual bot response: ${actualResponse.slice(0, 500)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'novo-after-glp1.png') }).catch(() => {});

    if (!matchedResponsePhrase) {
      await page.screenshot({ path: join(REPORT_DIR, 'novo-response-fail.png') }).catch(() => {});
      logFailure('Step 5: Bot response to GLP-1 query', 'no response received', actualResponse);
    }
    expect(matchedResponsePhrase, 'Step 5: bot did not respond to "explain GLP-1 therapy"').not.toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'novo-complete.png') }).catch(() => {});
    console.log('[NOVO] Test complete — Novo Nordisk greeting and GLP-1 response verified.');
  });
});
