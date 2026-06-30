import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForAnyNewOccurrence, sendMessage, getAllFramesText, captureBaselines,
} from './helpers/browser-utils.js';

const BOT_URL = 'https://bit.ly/TAIBAH-AI-QnA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'TAIBAH UNIVERSITY Q&A Agent greeting and Arabic response flow';
const TEST_NAME   = 'TAIBAH UNIVERSITY Q&A Agent greeting and Arabic response flow';

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

test.describe('TAIBAH UNIVERSITY Q&A Agent — Greeting and Arabic Response Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[TAIBAH] Navigating to TAIBAH UNIVERSITY Q&A Agent bot...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'taibah-startup.png') }).catch(() => {});
    await checkAndHandleCloudflare(page, '[TAIBAH]', REPORT_DIR);
    console.log('[TAIBAH] Page loaded.');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    console.log('[TAIBAH] Opening chat widget (up to 60s)...');
    const chatOpened = await openChatWidget(page, {
      prefix: '[TAIBAH]',
      failScreenshotPath: join(REPORT_DIR, 'taibah-open-btn-not-found.png'),
      timeoutMs: 60000,
    });
    if (!chatOpened) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      logFailure('Step 2: Chat button', 'no chat button found', vis.join(', '));
      throw new Error('[TAIBAH] Chat button not found after 60s. Visible: ' + vis.join(', '));
    }
    console.log('[TAIBAH] Chat opened.');
    await sleep(2000);

    // ── Step 3: Wait for greeting ─────────────────────────────────────────────
    const GREETING_PHRASES = [
      'مرحباً', 'مرحبا',
      'أهلاً وسهلاً', 'أهلاً', 'أهلا',
      'السلام عليكم',
      'دانا', 'Dana',
      'جامعة طيبة', 'طيبة',
      'كيف يمكنني مساعدتك', 'كيف يمكنني',
      'كيف أستطيع مساعدتك', 'كيف أستطيع',
      'مساعدتك', 'يمكنني مساعدتك',
      'مساء', 'صباح',
      'How can I help', 'how can I help',
      'Hello', 'Welcome', 'Hi there',
      'help you today', 'help you',
    ];
    const greetingBaselines = await captureBaselines(page, GREETING_PHRASES);

    console.log('[TAIBAH] Waiting up to 60s for bot greeting...');
    const matchedGreetingPhrase = await waitForAnyNewOccurrence(page, GREETING_PHRASES, greetingBaselines, 60000);

    await sleep(1000);
    const actualGreeting = await getAllFramesText(page);
    console.log(`[TAIBAH] Greeting detected via phrase: "${matchedGreetingPhrase}"`);
    console.log('[TAIBAH] Actual greeting:', actualGreeting.slice(0, 500));
    await page.screenshot({ path: join(REPORT_DIR, 'taibah-greeting.png') }).catch(() => {});

    if (!matchedGreetingPhrase) {
      await page.screenshot({ path: join(REPORT_DIR, 'taibah-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', actualGreeting);
    }
    expect(matchedGreetingPhrase, 'Step 3: bot did not send a greeting').not.toBeNull();
    console.log('[TAIBAH] Greeting validated. Sending Arabic user message now.');

    // ── Step 4: Send Arabic question ──────────────────────────────────────────
    const RESPONSE_PHRASES = [
      'تخصص', 'تخصصات', 'كلية', 'كليات', 'قسم', 'أقسام',
      'برنامج', 'برامج', 'بكالوريوس', 'ماجستير', 'دكتوراه',
      'specialization', 'faculty', 'department', 'college',
      'program', 'bachelor', 'master', 'science', 'engineering',
    ];
    const responseBaselines = await captureBaselines(page, RESPONSE_PHRASES);

    console.log('[TAIBAH] Sending Arabic message: "ما هي تخصصات جامعة طيبة؟"');
    await sendMessage(page, 'ما هي تخصصات جامعة طيبة؟');
    console.log('[TAIBAH] Arabic message sent — waiting up to 60s for bot response.');

    // ── Step 5: Validate bot response ─────────────────────────────────────────
    const matchedResponsePhrase = await waitForAnyNewOccurrence(page, RESPONSE_PHRASES, responseBaselines, 60000);

    await sleep(1000);
    const actualResponse = await getAllFramesText(page);
    console.log(`[TAIBAH] Response detected via phrase: "${matchedResponsePhrase}"`);
    console.log('[TAIBAH] Actual response:', actualResponse.slice(0, 500));
    await page.screenshot({ path: join(REPORT_DIR, 'taibah-after-question.png') }).catch(() => {});

    if (!matchedResponsePhrase) {
      await page.screenshot({ path: join(REPORT_DIR, 'taibah-response-fail.png') }).catch(() => {});
      logFailure('Step 5: Bot response to Arabic question', 'no response received', actualResponse);
    }
    expect(matchedResponsePhrase, 'Step 5: bot did not respond to the Arabic question').not.toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'taibah-complete.png') }).catch(() => {});
    console.log('[TAIBAH] Test complete — TAIBAH UNIVERSITY Q&A Agent greeting and Arabic response verified.');
  });
});
