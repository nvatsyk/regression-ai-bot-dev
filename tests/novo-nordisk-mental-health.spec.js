import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL = 'https://demo.nextlevel.ai/custom/novo-nordisk';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Novo Nordisk Mental Health bot greeting and response flow';
const TEST_NAME   = 'Novo Nordisk Mental Health bot greeting and response flow';

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

// Sends a message via the chat input. Targets the named chat input first to
// avoid strict-mode errors when multiple textboxes exist on the page.
async function sendMessage(page, text, { inputWaitMs = 60000 } = {}) {
  // Prefer the dedicated chat input; fall back to the first visible textbox.
  const chatInput = page.locator('input[name="chat"], textarea[name="chat"]').first();
  const chatFound = await chatInput.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  const input = chatFound ? chatInput : page.getByRole('textbox').first();

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

test.describe('Novo Nordisk Mental Health — Greeting and Response Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(240000); // 4 min: load + session start + greeting + response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[NOVO-MH] Navigating to Novo Nordisk Mental Health page...');
    await page.goto(BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'novo-mh-startup.png') }).catch(() => {});
    console.log('[NOVO-MH] Page loaded.');

    // ── Step 2: Scroll down ───────────────────────────────────────────────────
    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(1000);
    console.log('[NOVO-MH] Scrolled down.');
    await page.screenshot({ path: join(REPORT_DIR, 'novo-mh-scrolled.png') }).catch(() => {});

    // ── Step 3: Click "Start New Session" ────────────────────────────────────
    console.log('[NOVO-MH] Looking for "Start New Session" button...');
    const startBtn = page.getByRole('button', { name: /start new session/i }).first();
    const startFound = await startBtn.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);

    if (!startFound) {
      const startBtnText = page.getByText('Start New Session', { exact: false }).first();
      const startFoundText = await startBtnText.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      if (!startFoundText) {
        const vis = await page.evaluate(() =>
          Array.from(document.querySelectorAll('button,[role="button"],a'))
            .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
        ).catch(() => []);
        console.log('[NOVO-MH] "Start New Session" not found. Visible elements:', vis);
        await page.screenshot({ path: join(REPORT_DIR, 'novo-mh-start-btn-not-found.png') }).catch(() => {});
        logFailure('Step 3: Start New Session', '"Start New Session" button not found', vis.join(', '));
        throw new Error('[NOVO-MH] "Start New Session" button not found.');
      }
      await startBtnText.click();
    } else {
      await startBtn.click();
    }
    console.log('[NOVO-MH] "Start New Session" clicked.');
    await page.screenshot({ path: join(REPORT_DIR, 'novo-mh-after-start.png') }).catch(() => {});

    // Brief pause so the chat panel can open and settle before snapshotting baselines.
    await sleep(2000);

    // ── Step 4: Wait for greeting ─────────────────────────────────────────────
    // Use multi-word phrases specific to a mental health chat greeting — avoids
    // false positives from single letters appearing in outer page text.
    const GREETING_PHRASES = [
      'how are you feeling', 'how are you', 'How are you',
      'here for you', 'Here for you',
      'feeling today', 'Feeling today',
      'How can I help', 'how can I help',
      'welcome back', 'Welcome back',
      'Hello!', 'Hi!',
      'mental health', 'mental well',
      'support you', 'support today',
    ];
    const greetingBaselines = {};
    for (const p of GREETING_PHRASES) {
      greetingBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[NOVO-MH] Waiting up to 60s for bot greeting...');
    const matchedGreetingPhrase = await waitForAnyNewOccurrence(page, GREETING_PHRASES, greetingBaselines, 60000);

    await sleep(1000); // let the greeting finish rendering
    const actualGreeting = await getAllFramesText(page);
    console.log(`[NOVO-MH] Greeting detected via phrase: "${matchedGreetingPhrase}"`);
    console.log('[NOVO-MH] Actual greeting text:', actualGreeting.slice(0, 500));
    await page.screenshot({ path: join(REPORT_DIR, 'novo-mh-greeting.png') }).catch(() => {});

    if (!matchedGreetingPhrase) {
      await page.screenshot({ path: join(REPORT_DIR, 'novo-mh-greeting-fail.png') }).catch(() => {});
      logFailure('Step 4: Greeting', 'no greeting received', actualGreeting);
    }
    expect(matchedGreetingPhrase, 'Step 4: bot did not send a greeting').not.toBeNull();
    console.log('[NOVO-MH] Greeting validated. Sending user message now.');

    // ── Step 5: Send "good" ───────────────────────────────────────────────────
    // Baselines captured AFTER greeting is confirmed so any new bot content is
    // detected as a response. Wide phrase list covers all likely phrasings.
    const RESPONSE_PHRASES = [
      // Positive acknowledgments
      "glad to hear", "Glad to hear",
      "great to hear", "Great to hear",
      "good to hear", "Good to hear",
      "happy to hear", "Happy to hear",
      "pleased to hear", "Pleased to hear",
      "wonderful", "Wonderful",
      "excellent", "Excellent",
      "fantastic", "Fantastic",
      "perfect", "Perfect",
      "awesome", "Awesome",
      "that's great", "That's great",
      "that is great", "That is great",
      // Follow-up questions
      "tell me more", "Tell me more",
      "how long", "How long",
      "can you share", "can you tell",
      "what else", "What else",
      "would you like", "Would you like",
      "how can I help", "How can I help",
      "how can I support", "How can I support",
      "what brings you", "What brings you",
      "what would you", "What would you",
      "let's talk", "Let's talk",
      // Empathy / acknowledgment
      "sounds like", "Sounds like",
      "I understand", "I hear you",
      "thank you for", "Thank you for",
      "I'm glad", "I am glad",
      "I'm happy", "I am happy",
      // Generic continuations
      "of course", "Of course",
      "certainly", "Certainly",
      "absolutely", "Absolutely",
      "I see", "noted", "sure",
    ];
    const responseBaselines = {};
    for (const p of RESPONSE_PHRASES) {
      responseBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const sentAt = Date.now();
    console.log(`[NOVO-MH] Sending: "good" at ${new Date(sentAt).toISOString()}`);
    await sendMessage(page, 'good');
    console.log('[NOVO-MH] Message sent — waiting up to 90s for bot response.');

    // ── Step 6: Validate bot response ─────────────────────────────────────────
    const matchedResponsePhrase = await waitForAnyNewOccurrence(page, RESPONSE_PHRASES, responseBaselines, 90000);
    const responseMs = Date.now() - sentAt;

    await sleep(1000);
    const actualResponse = await getAllFramesText(page);
    console.log(`[NOVO-MH] Response detected via phrase: "${matchedResponsePhrase}" (${responseMs}ms after send)`);
    console.log('[NOVO-MH] Actual bot response:', actualResponse.slice(0, 500));
    await page.screenshot({ path: join(REPORT_DIR, 'novo-mh-after-good.png') }).catch(() => {});

    if (!matchedResponsePhrase) {
      const dbg = await page.evaluate(() =>
        Array.from(document.querySelectorAll('*'))
          .map(el => (el.innerText || el.textContent || '').trim())
          .filter(t => t.length > 10)
          .slice(0, 30)
          .join(' | ')
      ).catch(() => '');
      console.log('[NOVO-MH] DEBUG — visible page text nodes:', dbg.slice(0, 600));
      await page.screenshot({ path: join(REPORT_DIR, 'novo-mh-response-fail.png') }).catch(() => {});
      logFailure('Step 6: Bot response to "good"', 'no response received', actualResponse);
    }
    expect(matchedResponsePhrase, 'Step 6: bot did not respond to "good"').not.toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'novo-mh-complete.png') }).catch(() => {});
    console.log('[NOVO-MH] Test complete — Novo Nordisk Mental Health greeting and response verified.');
  });
});
