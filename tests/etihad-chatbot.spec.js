import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForAnyNewOccurrence, sendMessage,
} from './helpers/browser-utils.js';

const BOT_URL = 'https://sdemo.nextlevel.ai/etihad-chatbot';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'etihad-chatbot-fail-report.csv');
const TEST_NAME   = 'Etihad Chatbot — Greeting and Services Flow';

function csvEscape(v) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function logFailure(stepLabel, failedPhrase, pageText) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const row = [
    new Date().toISOString(), TEST_NAME, stepLabel, failedPhrase, pageText.slice(0, 400),
  ].map(csvEscape).join(',') + '\n';
  appendFileSync(REPORT_PATH, row);
}

async function checkPhraseGroups(page, phraseGroups) {
  for (const g of phraseGroups) {
    let matched = false;
    for (const phrase of g.phrases) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > 0) { matched = true; break; }
    }
    if (!matched) return g.label ?? g.phrases.join(' | ');
  }
  return null;
}

test.describe('Etihad Text ChatBot — Regression', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ───────────────────────────────────────────────────────
    console.log('[ETIHAD] Navigating to bot URL...');
    await navigateTo(page, BOT_URL);
    await checkAndHandleCloudflare(page, '[ETIHAD]', REPORT_DIR);

    // ── Step 2: Click "Text Chat" button ───────────────────────────────────────
    const chatOpened = await openChatWidget(page, {
      prefix: '[ETIHAD]',
      labels: ['Text Chat', 'Chat', 'Start Chat'],
      failScreenshotPath: join(REPORT_DIR, 'etihad-open-btn-not-found.png'),
      timeoutMs: 60000,
    });
    await page.screenshot({ path: join(REPORT_DIR, 'etihad-startup.png') }).catch(() => {});
    if (!chatOpened) {
      logFailure('Step 2: Chat button', 'Text Chat button not found', '');
      throw new Error('[ETIHAD] Text Chat button not found');
    }
    console.log('[ETIHAD] Clicked "Text Chat" button');

    const input = page.getByRole('textbox');
    await input.waitFor({ timeout: 30000 });

    console.log('[ETIHAD] Waiting for greeting to load...');
    await sleep(8000);
    await page.screenshot({ path: join(REPORT_DIR, 'etihad-greeting.png') }).catch(() => {});

    // ── Step 3: Validate greeting ──────────────────────────────────────────────
    const greetingFail = await checkPhraseGroups(page, [
      { label: '"Welcome to Etihad Airways"', phrases: [
        'Welcome to Etihad Airways', 'Etihad Airways', 'Etihad',
      ]},
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'etihad-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', greetingFail, '');
    }
    console.log(`[ETIHAD] ${greetingFail ? '[FAIL]' : '[PASS]'} Greeting validation`);
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4: Send "Hello" ───────────────────────────────────────────────────
    const step5Phrases = [
      'How may I assist you', 'How may I help',
      'assist you today', 'help you today',
      'How can I help', 'How can I assist',
      'What can I do for you', 'What can I help you with',
      'Welcome to Etihad',
    ];
    const step5Base = {};
    for (const p of step5Phrases) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[ETIHAD] Sending "Hello"...');
    await sendMessage(page, 'Hello');

    // ── Step 5: Validate response to "Hello" ──────────────────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Phrases, step5Base, 45000);
    if (!step5Arrived) console.log('[ETIHAD] Step 5 response did not arrive within 45s — asserting anyway');
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'etihad-after-hello.png') }).catch(() => {});

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"How may I assist you"', phrases: [
        'How may I assist you', 'How may I help',
        'assist you today', 'help you today',
        'How can I help', 'How can I assist',
        'What can I do for you', 'What can I help you with',
        'Welcome to Etihad',
      ]},
    ]);
    if (step5Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'etihad-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Hello response', step5Fail, '');
    }
    console.log(`[ETIHAD] ${step5Fail ? '[FAIL]' : '[PASS]'} Hello response validation`);
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    // ── Step 6: Send "tell me about your services" ─────────────────────────────
    const step7Phrases = [
      'Just a moment',
      'flights, check flight status',
      'manage baggage',
      'arrange special services',
      'answer questions about our policies',
      'travel requirements',
      'check flight status',
      'baggage',
      'special services',
      'policies',
    ];
    const step7Base = {};
    for (const p of step7Phrases) {
      step7Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[ETIHAD] Sending "tell me about your services"...');
    await sendMessage(page, 'tell me about your services');
    await sleep(3000);

    // ── Step 7: Validate services response ────────────────────────────────────
    const step7Arrived = await waitForAnyNewOccurrence(page, step7Phrases, step7Base, 60000);
    if (!step7Arrived) console.log('[ETIHAD] Step 7 response did not arrive within 60s — asserting anyway');
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'etihad-after-services.png') }).catch(() => {});

    const step7Fail = await checkPhraseGroups(page, [
      { label: 'services response', phrases: [
        'Just a moment',
        'flights, check flight status',
        'manage baggage',
        'arrange special services',
        'answer questions about our policies',
        'travel requirements',
        'check flight status',
        'baggage',
        'special services',
        'policies',
      ]},
    ]);
    if (step7Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'etihad-step7-fail.png') }).catch(() => {});
      logFailure('Step 7: Services response', step7Fail, '');
    }
    console.log(`[ETIHAD] ${step7Fail ? '[FAIL]' : '[PASS]'} Services response validation`);
    expect(step7Fail, `Step 7 failed: missing "${step7Fail}"`).toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'etihad-complete.png') }).catch(() => {});
    console.log('[ETIHAD] All steps passed — Etihad chatbot regression complete.');
  });
});
