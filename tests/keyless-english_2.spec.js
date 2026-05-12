import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G4UAKGTqHPlzBth8O49KPVnI3YuRTJOMEDWbUAK9Yduh5PWal-K-IN63Klq6_9JBKp5qrESF44g4Jy2jrTdyMApCl_mGtnAAVRrCPHCMZUFmP8dYFhtGkS6oQlLZBCUMKZKc5WXy3CkKfg';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Keyless English simple unlock regression';
const TEST_NAME   = 'Keyless English simple unlock method check';

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

// Polls until the occurrence count of phrase INCREASES beyond beforeCount.
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

test.describe('Keyless English — Simple Unlock Method Check', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(180000); // 3 min: greeting + 2 bot responses + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await page.goto(BOT_URL);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-startup.png') }).catch(() => {});

    // ── Step 2: Open Text Chat ────────────────────────────────────────────────
    let chatBtn = page.getByRole('button', { name: /text chat/i });
    const foundByRole = await chatBtn.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    if (!foundByRole) {
      chatBtn = page.getByText('Text Chat', { exact: false }).first();
      await chatBtn.waitFor({ timeout: 30000 });
    }
    await chatBtn.click();

    // ── Step 3: Wait for and validate greeting ────────────────────────────────
    // Wait for the GREETING MESSAGE body (not just the widget header "Ahmed AI").
    // 'help you with' appears only in the message "What can I help you with today".
    const greetingArrived = await waitForNewOccurrence(page, 'help you with', 0, 40000);
    if (!greetingArrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-greeting-timeout.png') }).catch(() => {});
    }
    await sleep(1000);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-greeting.png') }).catch(() => {});

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'UXE support mention',           phrases: ['UXE support', 'uxe support'] },
      { label: 'Ahmed introduction',             phrases: ['Ahmed', 'ahmed'] },
      { label: 'Keyless mention in greeting',    phrases: ['Keyless', 'keyless'] },
      { label: '"What can I help you" prompt',   phrases: ['What can I help you with today', 'help you with today', 'help you with'] },
    ]);
    if (greetingFail) {
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', greetingFail, '');
    }
    expect(greetingFail, `Step 3 greeting missing: "${greetingFail}"`).toBeNull();

    // ── Step 4: Send "to unlock the key" ─────────────────────────────────────
    await sendMessage(page, 'to unlock the key');

    // ── Step 5: Wait for and validate bot response ────────────────────────────
    // Poll for any expected phrase (none appear in greeting, so any hit = new response).
    const step5PollPhrases = [
      'Quick method check', 'method check',
      'How are you trying', 'trying to unlock',
      'Keyless mobile app', 'mobile app',
      'passcode', 'RFID', 'access card',
    ];
    const step5Base = {};
    for (const p of step5PollPhrases) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    // Re-send if session dropped
    const sesEndedBeforeStep5 = await page.getByText('session has ended', { exact: false }).count().catch(() => 0);
    if (sesEndedBeforeStep5 > 0) {
      console.log('[KE2] Session ended before step 5 — reconnecting');
      await page.getByRole('button', { name: /reconnect/i }).click().catch(() => {});
      const ahmedBase2 = await page.getByText('Ahmed', { exact: false }).count().catch(() => 0);
      await waitForNewOccurrence(page, 'Ahmed', ahmedBase2, 30000);
      await sleep(3000);
      await sendMessage(page, 'to unlock the key');
    }

    let step5Responded = false;
    const step5Deadline = Date.now() + 60000;
    while (Date.now() < step5Deadline && !step5Responded) {
      const sesEnd = await page.getByText('session has ended', { exact: false }).count().catch(() => 0);
      if (sesEnd > 0) { console.log('[KE2] Step 5: session ended during wait'); break; }
      for (const p of step5PollPhrases) {
        const now = await page.getByText(p, { exact: false }).count().catch(() => 0);
        if (now > step5Base[p]) { step5Responded = true; break; }
      }
      if (!step5Responded) await sleep(2000);
    }
    if (!step5Responded) {
      console.log('[KE2] Step 5: no expected phrase appeared within 60 s — asserting anyway');
    }
    await sleep(2000);
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-after-unlock-msg.png') }).catch(() => {});

    const step5Fail = await checkPhraseGroups(page, [
      { label: '"Quick method check" or how-to-unlock question', phrases: [
        'Quick method check', 'method check', 'quick method',
        'How are you trying', 'trying to unlock', 'how would you like',
        'how do you want to unlock',
      ]},
      { label: 'unlock method options (app/passcode/RFID/card)', phrases: [
        'Keyless mobile app', 'mobile app', 'the app',
        'passcode', 'RFID', 'rfid', 'access card',
      ]},
    ]);
    if (step5Fail) {
      await page.screenshot({ path: join(REPORT_DIR, 'ke2-fail-step5.png') }).catch(() => {});
      logFailure('Step 5: unlock method check response', step5Fail, '');
    }
    expect(step5Fail, `Step 5 failed: missing "${step5Fail}"`).toBeNull();

    // ── Step 6: Send "mobile app" — test passes after this send ──────────────
    // No further bot response required per spec.
    await sendMessage(page, 'mobile app');
    await page.screenshot({ path: join(REPORT_DIR, 'ke2-complete.png') }).catch(() => {});
    console.log('[KE2] Test complete — "mobile app" sent successfully.');
  });
});
