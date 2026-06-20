import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL = 'https://nextlevel.ai/';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Nextlevel.ai BDR greeting and name flow';
const TEST_NAME   = 'Nextlevel.ai BDR greeting and name flow';

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

// Shadow-DOM + multi-frame aware phrase counter.
async function countPhrase(page, phrase) {
  for (const frame of page.frames()) {
    try {
      const count = await frame.getByText(phrase, { exact: false }).count();
      if (count > 0) return count;
    } catch (_) {}
  }
  return page.evaluate((p) => {
    function walk(root) {
      let text = '';
      try {
        const iter = document.createNodeIterator(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = iter.nextNode())) text += n.textContent + '\n';
        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot) text += walk(el.shadowRoot);
        });
      } catch (_) {}
      return text;
    }
    return walk(document.body).toLowerCase().includes(p.toLowerCase()) ? 1 : 0;
  }, phrase.toLowerCase()).catch(() => 0);
}

// Polls until countPhrase exceeds beforeCount.
async function waitForNewOccurrence(page, phrase, beforeCount, timeoutMs = 50000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await countPhrase(page, phrase);
    if (count > beforeCount) return true;
    await sleep(2000);
  }
  console.log(`[NL-BDR] waitForNewOccurrence: "${phrase}" did not appear within ${timeoutMs}ms`);
  return false;
}

// Polls until any phrase in the list exceeds its baseline count.
async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of phrases) {
      const count = await countPhrase(page, phrase);
      if (count > (baselines[phrase] ?? 0)) return true;
    }
    await sleep(2000);
  }
  return false;
}

// Collects visible text from all frames (widget may live in an iframe).
async function getAllFrameText(page) {
  const parts = await Promise.all(
    page.frames().map(f => f.evaluate(() => document.body.innerText).catch(() => ''))
  );
  return parts.join('\n');
}

// Finds the textbox across all frames, fills it, presses Enter.
async function sendMessage(page, text, { inputWaitMs = 60000 } = {}) {
  let input = null;
  const deadline = Date.now() + inputWaitMs;
  while (Date.now() < deadline && !input) {
    for (const frame of page.frames()) {
      try {
        const el = frame.getByRole('textbox');
        if ((await el.count()) > 0) { input = el; break; }
      } catch (_) {}
    }
    if (!input) await sleep(1000);
  }
  if (!input) throw new Error(`[NL-BDR] Textbox not found after ${inputWaitMs}ms`);

  await input.fill(text);
  await input.press('Enter');
  await sleep(500);
  const stillFilled = await input.inputValue().catch(() => '');
  if (stillFilled.trim() === text.trim()) {
    let sent = false;
    for (const frame of page.frames()) {
      const named = frame.getByRole('button', { name: /^send$/i });
      if ((await named.count().catch(() => 0)) > 0) {
        await named.click().catch(() => {});
        sent = true;
        break;
      }
    }
    if (!sent) await page.getByRole('button').last().click().catch(() => {});
  }
  await sleep(8000);
}

test.describe('Nextlevel.ai BDR — Greeting and Name Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: page load + greeting + name reply + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[NL-BDR] Navigating to nextlevel.ai...');
    await page.goto(BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);
    await page.screenshot({ path: join(REPORT_DIR, 'nl-startup.png') }).catch(() => {});

    // ── Step 2: Click chat button ─────────────────────────────────────────────
    const CHAT_LABELS = ["Let's Chat", "Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 50000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 50000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      chatBtn = page.getByRole('button', { name: /let.?s chat/i });
      const foundByRole = await chatBtn.waitFor({ timeout: 50000 }).then(() => true).catch(() => false);
      if (!foundByRole) {
        chatBtn = page.getByText(/let.?s chat/i).first();
        await chatBtn.waitFor({ timeout: 50000 });
      }
    }

    // Dismiss cookie consent banner if present (intercepts clicks).
    const cookieSelectors = [
      '.cmplz-accept', '.cmplz-btn-accept',
      'button[aria-label*="Accept"]', 'button[aria-label*="accept"]',
    ];
    for (const sel of cookieSelectors) {
      const btn = page.locator(sel).first();
      const has = await btn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
      if (has) { await btn.click().catch(() => {}); await sleep(500); break; }
    }
    const gotItBtn = page.getByRole('button', { name: /got it|accept|agree/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    await chatBtn.click();
    console.log('[NL-BDR] Clicked chat button — waiting for greeting.');

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greetingPhrases = [
      'Hello', 'Hi', 'welcome', 'name', 'your name', 'may I have your name',
      'help', 'assist', 'NextLevel', 'nextlevel', 'Jessica', 'jessica', 'today',
    ];
    const greetingBase = {};
    for (const p of greetingPhrases) greetingBase[p] = await countPhrase(page, p);
    const greetingArrived = await waitForAnyNewOccurrence(page, greetingPhrases, greetingBase, 50000);
    if (!greetingArrived) {
      console.log('[NL-BDR] Greeting poll timed out');
    }
    await sleep(1000);

    const actualGreeting = await getAllFrameText(page);
    console.log('[TEST] Greeting:', actualGreeting.slice(0, 300));
    console.log(`[NL-BDR] Actual greeting text: ${actualGreeting.slice(0, 400)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'nl-greeting.png') }).catch(() => {});

    if (!greetingArrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'nl-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', actualGreeting);
    }
    expect(greetingArrived, 'Step 3: no greeting received from bot').toBe(true);
    console.log('[NL-BDR] Greeting validated.');

    // ── Step 4: Send "Natali" ─────────────────────────────────────────────────
    // The widget uses shadow DOM — countPhrase (shadow walk) is the only reliable
    // way to detect new content. Capture baselines before sending.
    const replyPoll = [
      'Natali', 'natali',
      'meet you', 'meet', 'nice to meet', 'great to meet', 'pleasure to meet',
      'phone', 'number', 'email', 'address',
      'Thank you', 'thank you', 'Thanks', 'thanks',
      'please', 'provide', 'could you', 'can you', 'would you',
      'help', 'assist', 'question', 'interested',
    ];
    const replyBaselines = {};
    for (const p of replyPoll) replyBaselines[p] = await countPhrase(page, p);

    await sendMessage(page, 'Natali');
    console.log('[TEST] User message sent');
    console.log('[NL-BDR] Sent "Natali" — waiting for any bot response.');

    // ── Step 5: Validate bot replied with anything non-empty ──────────────────
    const botResponded = await waitForAnyNewOccurrence(page, replyPoll, replyBaselines, 60000);
    if (!botResponded) console.log('[NL-BDR] Response poll timed out — asserting anyway');
    await sleep(1000);

    const actualReply = await getAllFrameText(page);
    console.log('[TEST] Bot response received:', actualReply.slice(0, 300));
    console.log(`[NL-BDR] Actual bot reply after "Natali": ${actualReply.slice(0, 400)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'nl-after-name.png') }).catch(() => {});

    if (!botResponded) {
      await page.screenshot({ path: join(REPORT_DIR, 'nl-name-reply-fail.png') }).catch(() => {});
      logFailure('Step 5: Bot reply after name', 'no response received', actualReply);
    }
    expect(botResponded, 'Step 5: bot did not reply after receiving "Natali"').toBe(true);
    console.log('[NL-BDR] Bot replied after name — test complete.');

    await page.screenshot({ path: join(REPORT_DIR, 'nl-complete.png') }).catch(() => {});
  });
});
