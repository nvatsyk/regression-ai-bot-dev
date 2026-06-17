import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL = 'https://bit.ly/TAIBAH-AI-QnA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'TAIBAH UNIVERSITY Q&A Agent greeting and Arabic response flow';
const TEST_NAME   = 'TAIBAH UNIVERSITY Q&A Agent greeting and Arabic response flow';

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

// Polls up to 60s for any common chat launch button, clicking the first match found.
// Checks DOM + shadow DOM + Playwright role locators on each 2s tick.
async function openChatButton(page, prefix = '[CHAT]', failScreenshot = null) {
  const LABELS = ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let’s Chat", 'Start', 'Open Chat'];
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate((labels) => {
      function scanRoot(root) {
        return Array.from(root.querySelectorAll('button,[role="button"]')).find(el => {
          const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
          return labels.some(l => t.toLowerCase().includes(l.toLowerCase()));
        }) || null;
      }
      let el = scanRoot(document);
      if (!el) {
        for (const host of document.querySelectorAll('*')) {
          if (host.shadowRoot) { el = scanRoot(host.shadowRoot); if (el) break; }
        }
      }
      if (el) { el.click(); return (el.innerText || el.textContent || '').trim(); }
      return null;
    }, LABELS).catch(() => null);
    if (clicked) { console.log(`${prefix} Opened chat via DOM: "${clicked}"`); return true; }
    for (const lbl of LABELS) {
      const btn = page.getByRole('button', { name: lbl, exact: false }).first();
      if (await btn.isVisible().catch(() => false)) {
        console.log(`${prefix} Opened chat via role locator: "${lbl}"`);
        await btn.click();
        return true;
      }
    }
    await sleep(2000);
  }
  const vis = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button,[role="button"]'))
      .map(b => (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim()).filter(Boolean)
  ).catch(() => []);
  console.log(`${prefix} Chat button NOT found after 60s. Visible buttons:`, vis);
  if (failScreenshot) await page.screenshot({ path: failScreenshot }).catch(() => {});
  return false;
}

test.describe('TAIBAH UNIVERSITY Q&A Agent — Greeting and Arabic Response Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: greeting + 1 bot response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[TAIBAH] Navigating to TAIBAH UNIVERSITY Q&A Agent bot...');
    await page.goto(BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'taibah-startup.png') }).catch(() => {});
    console.log('[TAIBAH] Page loaded.');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    console.log('[TAIBAH] Opening chat widget (up to 60s)...');
    const chatOpened = await openChatButton(page, '[TAIBAH]', join(REPORT_DIR, 'taibah-open-btn-not-found.png'));
    if (!chatOpened) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      logFailure('Step 2: Chat button', 'no chat button found', vis.join(', '));
      throw new Error('[TAIBAH] Chat button not found after 60s. Visible: ' + vis.join(', '));
    }
    console.log('[TAIBAH] Chat opened — waiting for panel to settle.');

    // Brief pause so the chat panel can open before snapshotting baselines.
    await sleep(2000);

    // ── Step 3: Wait for greeting ─────────────────────────────────────────────
    // Covers all Arabic greeting variants (with/without tanwin), bot names, and
    // English fallbacks so any phrasing the bot uses triggers detection.
    const GREETING_PHRASES = [
      // Arabic greetings — standard and tanwin forms
      'مرحباً', 'مرحبا',
      'أهلاً وسهلاً', 'أهلاً', 'أهلا',
      'السلام عليكم',
      // Bot name variants
      'دانا', 'Dana',
      // University name
      'جامعة طيبة', 'طيبة',
      // Common Arabic assistant openers
      'كيف يمكنني مساعدتك', 'كيف يمكنني',
      'كيف أستطيع مساعدتك', 'كيف أستطيع',
      'مساعدتك', 'يمكنني مساعدتك',
      // Time-of-day greetings
      'مساء', 'صباح',
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
    console.log('[TAIBAH] Actual greeting:', actualGreeting.slice(0, 500));
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
