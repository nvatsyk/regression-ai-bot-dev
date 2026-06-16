import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G4UAKGTqHPlzBth8O49KPVnI3YuRTJOMEDWbUAK9Yduh5PWal-K-IN63Klq6_9JBKp5qrESF44g4Jy2jrTdyMApCl_mGtnAAVRrCPHCMZUFmP8dYFhtGkS6oQlLZBCUMKZKc5WXy3CkKfg';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Keyless English greeting and unlock reply flow';
const TEST_NAME   = 'Keyless English greeting and unlock reply flow';

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

// Polls until the occurrence count of a phrase INCREASES beyond beforeCount.
async function waitForNewOccurrence(page, phrase, beforeCount, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
    if (count > beforeCount) return true;
    await sleep(2000);
  }
  console.log(`[KE2] waitForNewOccurrence: "${phrase}" did not appear within ${timeoutMs}ms`);
  return false;
}

// Polls until any phrase in the list exceeds its baseline count.
async function waitForAnyNewOccurrence(page, phrases, baselines, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of phrases) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > (baselines[phrase] ?? 0)) return true;
    }
    await sleep(2000);
  }
  return false;
}

// Returns the label of the first phrase group that has NO match, or null if all pass.
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

test.describe('Keyless English — Greeting and Unlock Reply Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: greeting + 1 bot response + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[KE2] Navigating to Keyless English bot...');
    await page.goto(BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-startup.png') }).catch(() => {});

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    const CHAT_LABELS = ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", 'Let’s Chat'];
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
      console.log('[KE2] Chat button not found. Visible buttons:', vis);
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-open-btn-not-found.png') }).catch(() => {});
      throw new Error(`[KE2] Chat button not found. Tried: ${CHAT_LABELS.join(', ')}. Visible: ${vis.join(', ')}`);
    }
    console.log('[KE2] Found chat button — clicking.');
    await chatBtn.click();

    // ── Step 3: Wait for and validate greeting ────────────────────────────────
    const greetingArrived = await waitForNewOccurrence(page, 'help you with', 0, 40000);
    if (!greetingArrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-greeting-timeout.png') }).catch(() => {});
      console.log('[KE2] Greeting poll timed out — asserting anyway');
    }
    await sleep(1000);

    const actualGreeting = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log(`[KE2] Actual greeting text: ${actualGreeting.slice(0, 400)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-greeting.png') }).catch(() => {});

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'UXE support mention',         phrases: ['UXE support', 'uxe support'] },
      { label: 'Ahmed introduction',           phrases: ['Ahmed', 'ahmed'] },
      { label: 'Keyless mention in greeting',  phrases: ['Keyless', 'keyless'] },
      { label: '"What can I help you" prompt', phrases: ['What can I help you with today', 'help you with today', 'help you with'] },
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', greetingFail, actualGreeting);
    }
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();
    console.log('[KE2] Greeting validated.');

    // ── Step 4: Send "to unlock the key" ─────────────────────────────────────
    // Capture baselines before sending so any new content after the message counts.
    const replyPoll = [
      'unlock', 'sort', 'right now', 'currently', 'trying',
      'mobile app', 'mobile', 'passcode', 'RFID', 'rfid',
      'access card', 'keypad', 'method', 'How are you',
      'We can', 'can help', 'let me', 'please', 'could you',
    ];
    const replyBaselines = {};
    for (const p of replyPoll) {
      replyBaselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'to unlock the key');
    console.log('[KE2] Sent "to unlock the key" — waiting for any bot response.');

    // ── Step 5: Validate bot replied with anything non-empty ──────────────────
    const botResponded = await waitForAnyNewOccurrence(page, replyPoll, replyBaselines, 60000);
    if (!botResponded) console.log('[KE2] Response poll timed out — asserting anyway');
    await sleep(1000);

    const actualReply = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log(`[KE2] Actual bot reply: ${actualReply.slice(0, 400)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-after-unlock-msg.png') }).catch(() => {});

    if (!botResponded) {
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-reply-fail.png') }).catch(() => {});
      logFailure('Step 5: Bot reply after "to unlock the key"', 'no response received', actualReply);
    }
    expect(botResponded, 'Step 5: bot did not reply after "to unlock the key"').toBe(true);

    await page.screenshot({ path: join(REPORT_DIR, 'ke2-complete.png') }).catch(() => {});
    console.log('[KE2] Test complete — Keyless greeting and unlock reply verified.');
  });
});
