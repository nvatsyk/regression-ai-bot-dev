import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL = 'https://bit.ly/TAIBAH-AI-QnA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('taibah-ai-qa', REPORT_DIR);
const BUG_TITLE   = 'TAIBAH UNIVERSITY Q&A Agent greeting and Arabic response flow';
const TEST_NAME   = 'TAIBAH UNIVERSITY Q&A Agent greeting and Arabic response flow';

test.describe('TAIBAH UNIVERSITY Q&A Agent — Greeting and Arabic Response Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1-2: Navigate + open chat ────────────────────────────────────────
    console.log('[TAIBAH] Navigating to TAIBAH UNIVERSITY Q&A Agent bot...');
    await navigateTo(page, BOT_URL);
    await screenshotStage(page, REPORT_DIR, 'taibah', 'startup');
    await openChat(page, { prefix: '[TAIBAH]', reportDir: REPORT_DIR, timeoutMs: 60000 });
    console.log('[TAIBAH] Chat opened.');

    // ── Step 3: Wait for + validate greeting (content-diff is language ───────
    // agnostic, so it works for the Arabic greeting without a phrase list) ───
    const greetingText = await waitForGreeting(page, { prefix: '[TAIBAH]', reportDir: REPORT_DIR, timeoutMs: 60000 });
    console.log('[TAIBAH] Actual greeting:', greetingText.slice(0, 500));
    await screenshotStage(page, REPORT_DIR, 'taibah', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'Arabic/English greeting phrase', phrases: [
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
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'taibah', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Greeting', greetingFail, greetingText]);
    }
    expect(greetingFail, `Step 3 greeting missing expected wording: "${greetingFail}"`).toBeNull();
    console.log('[TAIBAH] Greeting validated. Sending Arabic user message now.');

    // ── Step 4-5: Send Arabic question and validate response ─────────────────
    console.log('[TAIBAH] Sending Arabic message: "ما هي تخصصات جامعة طيبة؟"');
    const questionBaseline = await getAllFramesText(page);
    await sendMessage(page, 'ما هي تخصصات جامعة طيبة؟');
    const responseText = await waitForBotResponse(page, {
      prefix: '[TAIBAH]', reportDir: REPORT_DIR,
      baselineText: questionBaseline, sentText: 'ما هي تخصصات جامعة طيبة؟', timeoutMs: 60000,
    });
    console.log('[TAIBAH] Actual response:', responseText.slice(0, 500));
    await screenshotStage(page, REPORT_DIR, 'taibah', 'after-question');

    const responseFail = await checkPhraseGroups(page, [
      { label: 'Arabic/English program-related response', phrases: [
        'تخصص', 'تخصصات', 'كلية', 'كليات', 'قسم', 'أقسام',
        'برنامج', 'برامج', 'بكالوريوس', 'ماجستير', 'دكتوراه',
        'specialization', 'faculty', 'department', 'college',
        'program', 'bachelor', 'master', 'science', 'engineering',
      ]},
    ]);
    if (responseFail) {
      await screenshotStage(page, REPORT_DIR, 'taibah', 'response-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 5: Bot response to Arabic question', responseFail, responseText]);
    }
    expect(responseFail, `Step 5 response missing expected wording: "${responseFail}"`).toBeNull();

    await screenshotStage(page, REPORT_DIR, 'taibah', 'complete');
    console.log('[TAIBAH] Test complete — TAIBAH UNIVERSITY Q&A Agent greeting and Arabic response verified.');
  });
});
