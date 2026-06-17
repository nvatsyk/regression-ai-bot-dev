import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL = 'https://bit.ly/Novo-Nordisk-QnA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Novo Nordisk Q&A Agent greeting and GLP-1 response flow';
const TEST_NAME   = 'Novo Nordisk Q&A Agent greeting and GLP-1 response flow';

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

// Captures innerText from all frames (main + iframes) so bot content is visible.
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

// Polls until the occurrence count of ANY phrase INCREASES beyond its baseline.
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
  const LABELS = ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let's Chat", 'Start', 'Open Chat'];
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

test.describe('Novo Nordisk Q&A Agent — Greeting and GLP-1 Response Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: greeting + 1 bot response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[NOVO] Navigating to Novo Nordisk Q&A Agent...');
    await page.goto(BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'novo-startup.png') }).catch(() => {});

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    console.log('[NOVO] Opening chat widget (up to 60s)...');
    const chatOpened = await openChatButton(page, '[NOVO]', join(REPORT_DIR, 'novo-open-btn-not-found.png'));
    if (!chatOpened) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      logFailure('Step 2: Chat button', 'no chat button found', vis.join(', '));
      throw new Error('[NOVO] Chat button not found after 60s. Visible: ' + vis.join(', '));
    }
    console.log('[NOVO] Chat opened — waiting for panel to settle.');

    // Brief pause so the chat panel can open before we snapshot baselines.
    await sleep(2000);

    // ── Step 3: Wait for greeting ─────────────────────────────────────────────
    // Use Nour/Novo-specific phrases to avoid false positives from outer page text.
    const GREETING_PHRASES = [
      'Nour', 'health coach', 'GLP-1', 'GLP1', 'medical advice',
      'not a doctor', 'help you today', 'How can I help',
      'educational', 'therapy',
    ];
    const greetingBaselines = {};
    for (const p of GREETING_PHRASES) {
      greetingBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    console.log('[NOVO] Waiting up to 60s for bot greeting...');
    const matchedGreetingPhrase = await waitForAnyNewOccurrence(page, GREETING_PHRASES, greetingBaselines, 60000);

    await sleep(1000); // let the greeting finish rendering
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
    // Baselines captured AFTER greeting is confirmed.
    const RESPONSE_PHRASES = [
      'GLP-1', 'GLP1', 'therapy', 'hormone', 'hunger', 'medicine',
      'insulin', 'blood sugar', 'weight', 'reduce', 'body makes',
      'glucagon', 'appetite', 'type 2', 'diabetes',
    ];
    const responseBaselines = {};
    for (const p of RESPONSE_PHRASES) {
      responseBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

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
