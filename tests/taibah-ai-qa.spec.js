import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL = 'https://bit.ly/TAIBAH-AI-QnA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Taibah AI Q&A greeting and Arabic response flow';
const TEST_NAME   = 'Taibah AI Q&A greeting and Arabic response flow';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// Captures innerText from all frames (main + iframes).
async function getAllFramesText(page) {
  const parts = [];
  for (const frame of page.frames()) {
    const t = await frame.evaluate(() =>
      document.body ? document.body.innerText : ''
    ).catch(() => '');
    if (t.trim()) parts.push(t.trim());
  }
  return parts.join('\n');
}

async function sendMessage(page, text, { inputWaitMs = 60000 } = {}) {
  const input = page.getByRole('textbox');
  await input.waitFor({ timeout: inputWaitMs });
  await input.fill(text);
  await input.press('Enter');
  await sleep(500);
  const stillFilled = await input.inputValue().catch(() => '');
  if (stillFilled.trim() === text.trim()) {
    const named = page.getByRole('button', { name: /^send$/i });
    const hasSend = (await named.count().catch(() => 0)) > 0;
    await (hasSend ? named : page.getByRole('button').last()).click().catch(() => {});
  }
  await sleep(8000);
}

// Polls until the count of ANY phrase increases beyond its baseline.
// Returns the matched phrase or null on timeout.
async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of phrases) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > (baselines[phrase] ?? 0)) return phrase;
    }
    await sleep(2000);
  }
  return null;
}

test.describe('Taibah AI Q&A — Greeting and Arabic Response Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: greeting + 1 bot response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[TAIBAH] Navigating to Taibah AI Q&A bot...');
    await page.goto(BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'taibah-startup.png') }).catch(() => {});
    console.log('[TAIBAH] Page loaded.');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    const CHAT_LABELS = ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let's Chat"];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 30000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      console.log('[TAIBAH] Chat button not found. Visible buttons:', vis);
      await page.screenshot({ path: join(REPORT_DIR, 'taibah-open-btn-not-found.png') }).catch(() => {});
      logFailure('Step 2: Chat button', 'no chat button found', vis.join(', '));
      throw new Error(`[TAIBAH] Chat button not found. Tried: ${CHAT_LABELS.join(', ')}. Visible: ${vis.join(', ')}`);
    }
    console.log('[TAIBAH] Found chat button — clicking.');
    await chatBtn.click();

    // Brief pause so the chat panel can open before snapshotting baselines.
    await sleep(2000);

    // ── Step 3: Wait for greeting ─────────────────────────────────────────────
    // Mix of Arabic greeting keywords and English fallbacks. The baseline is
    // captured after the click so any count increase indicates a new bot message.
    const GREETING_PHRASES = [
      // Arabic greetings and common bot intro phrases
      'مرحبا', 'أهلا', 'أهلً', 'مساء', 'صباح',
      'كيف يمكنني', 'مساعدتك', 'يمكنني مساعدتك',
      'جامعة طيبة', 'طيبة',
      // English fallbacks
      'How can I help', 'how can I help',
      'Hello', 'Welcome', 'Hi there',
      'help you today', 'help you',
    ];
    const greetingBaselines = {};
    for (const p of GREETING_PHRASES) {
      greetingBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[TAIBAH] Waiting up to 60s for bot greeting...');
    const matchedGreetingPhrase = await waitForAnyNewOccurrence(page, GREETING_PHRASES, greetingBaselines, 60000);

    await sleep(1000); // let the greeting finish rendering
    const actualGreeting = await getAllFramesText(page);
    console.log(`[TAIBAH] Greeting detected via phrase: "${matchedGreetingPhrase}"`);
    console.log(`[TAIBAH] Actual greeting text: ${actualGreeting.slice(0, 500)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'taibah-greeting.png') }).catch(() => {});

    if (!matchedGreetingPhrase) {
      await page.screenshot({ path: join(REPORT_DIR, 'taibah-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', actualGreeting);
    }
    expect(matchedGreetingPhrase, 'Step 3: bot did not send a greeting').not.toBeNull();
    console.log('[TAIBAH] Greeting validated. Sending Arabic user message now.');

    // ── Step 4: Send Arabic question ──────────────────────────────────────────
    // Baselines captured AFTER greeting is confirmed.
    const RESPONSE_PHRASES = [
      // Arabic response signals for a university specializations question
      'تخصص', 'تخصصات', 'كلية', 'كليات', 'قسم', 'أقسام',
      'برنامج', 'برامج', 'بكالوريوس', 'ماجستير', 'دكتوراه',
      // English response signals (bot may respond in English)
      'specialization', 'faculty', 'department', 'college',
      'program', 'bachelor', 'master', 'science', 'engineering',
    ];
    const responseBaselines = {};
    for (const p of RESPONSE_PHRASES) {
      responseBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[TAIBAH] Sending Arabic message: "ما هي تخصصات جامعة طيبة؟"');
    await sendMessage(page, 'ما هي تخصصات جامعة طيبة؟');
    console.log('[TAIBAH] Arabic message sent — waiting up to 60s for bot response.');

    // ── Step 5: Validate bot response ─────────────────────────────────────────
    const matchedResponsePhrase = await waitForAnyNewOccurrence(page, RESPONSE_PHRASES, responseBaselines, 60000);

    await sleep(1000);
    const actualResponse = await getAllFramesText(page);
    console.log(`[TAIBAH] Response detected via phrase: "${matchedResponsePhrase}"`);
    console.log(`[TAIBAH] Actual bot response: ${actualResponse.slice(0, 500)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'taibah-after-question.png') }).catch(() => {});

    if (!matchedResponsePhrase) {
      await page.screenshot({ path: join(REPORT_DIR, 'taibah-response-fail.png') }).catch(() => {});
      logFailure('Step 5: Bot response to Arabic question', 'no response received', actualResponse);
    }
    expect(matchedResponsePhrase, 'Step 5: bot did not respond to the Arabic question').not.toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'taibah-complete.png') }).catch(() => {});
    console.log('[TAIBAH] Test complete — Taibah AI greeting and Arabic response verified.');
  });
});
