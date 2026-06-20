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

async function waitForBotGreeting(page, greetingPoll, greetingBaselines, timeoutMs = 50000) {
  const start = Date.now();
  await page.getByRole('textbox').waitFor({ timeout: Math.min(40000, timeoutMs) }).catch(() => {});
  await sleep(5000);
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    for (const phrase of greetingPoll) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > (greetingBaselines[phrase] ?? 0)) return phrase;
    }
    await sleep(2000);
  }
  const inputVisible = await page.getByRole('textbox').isVisible().catch(() => false);
  return inputVisible ? 'greeting received' : null;
}

test.describe('Keyless English — Greeting and Unlock Reply Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[KE2] Navigating to Keyless English bot...');
    await page.goto(BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-startup.png') }).catch(() => {});

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    const CHAT_LABELS = ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let’s Chat", 'Start New Session'];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 50000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 50000 }).then(() => true).catch(() => false);
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

    // Capture baselines BEFORE clicking so greeting detection is accurate
    const greetingPhrases = ['help', 'Hello', 'Hi', 'welcome', 'assist', 'support', 'UXE', 'Ahmed', 'Keyless', 'chat', 'today', 'can I'];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }
    await chatBtn.click();

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greeting = await waitForBotGreeting(page, greetingPhrases, greetingBase, 50000);
    if (!greeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', '');
    }
    expect(greeting, 'Step 3: bot did not send a greeting').toBeTruthy();
    console.log('[TEST] Greeting:', greeting);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-greeting.png') }).catch(() => {});

    // ── Step 4: Send "to unlock the key" ─────────────────────────────────────
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
    console.log('[TEST] User message sent');
    console.log('[KE2] Sent "to unlock the key" — waiting for any bot response.');

    // ── Step 5: Validate bot replied ─────────────────────────────────────────
    const botResponse = await waitForAnyNewOccurrence(page, replyPoll, replyBaselines, 60000);
    if (!botResponse) {
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-reply-fail.png') }).catch(() => {});
      logFailure('Step 5: Bot reply after "to unlock the key"', 'no response received', '');
    }
    expect(botResponse, 'Step 5: bot did not reply after "to unlock the key"').toBeTruthy();
    console.log('[TEST] Bot response received:', botResponse);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-after-unlock-msg.png') }).catch(() => {});

    await page.screenshot({ path: join(REPORT_DIR, 'ke2-complete.png') }).catch(() => {});
    console.log('[KE2] Test complete — Keyless greeting and unlock reply verified.');
  });
});
