import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AiORyTmV30SWW488IbQoEOjlg_62oBVaAWVsuCQWa2xgKNjo320LNCZGm9j9l_FxcozWkpkkeMEYOgiEBu1CioGZbHkIrPaemMziiPPrGn4HWDimdcuUM2DcPVnALMHxG4K8BVJA-ZWsDCkT5_7vB-nf4C3EEYdafN828BnYdBFmzdEl1aWLZLi1JjkATTlJoWeJiuZagOzyPFg';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'Bengali appointment reminder greeting and multi-turn flow';
const TEST_NAME   = 'Bengali appointment reminder greeting and multi-turn flow';

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

// Snapshots current phrase counts — call just before expecting a new bot turn.
async function captureBaselines(page, phrases) {
  const baselines = {};
  for (const p of phrases) {
    baselines[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
  }
  return baselines;
}

test.describe('Bengali Appointment Reminder — Multi-Turn Conversation Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(300000); // 5 min: greeting + 2 exchanges + CI headroom

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[APPT-BN] Navigating to Bengali Appointment Reminder bot...');
    await page.goto(BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-startup.png') }).catch(() => {});
    console.log('[APPT-BN] Page loaded.');

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
    const CHAT_LABELS = ['Text Chat', 'Chat', 'Start Chat', "Let's Chat", "Let's Chat"];
    let chatBtn = null;
    for (const lbl of CHAT_LABELS) {
      const btn = page.getByText(lbl, { exact: false }).first();
      console.log(`[CHAT] Waiting up to 40000ms for chat button: ${lbl}`);
      const found = await btn.waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
      if (found) { chatBtn = btn; break; }
    }
    if (!chatBtn) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      console.log('[APPT-BN] Chat button not found. Visible buttons:', vis);
      await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-open-btn-not-found.png') }).catch(() => {});
      logFailure('Step 2: Chat button', 'no chat button found', vis.join(', '));
      throw new Error(`[APPT-BN] Chat button not found. Tried: ${CHAT_LABELS.join(', ')}. Visible: ${vis.join(', ')}`);
    }
    console.log('[APPT-BN] Found chat button — clicking.');
    await chatBtn.click();
    console.log('[APPT-BN] Text Chat clicked.');

    // Brief pause so the chat panel can open before snapshotting baselines.
    await sleep(2000);

    // ── Step 3: Wait for first bot greeting ───────────────────────────────────
    // Bot greets in Bengali, e.g. "হ্যালো, আমি Jessica। ফিউচার হেলথ-এর পক্ষ থেকে..."
    const GREETING_PHRASES = [
      // Bengali greeting keywords
      'হ্যালো', 'ফিউচার হেলথ', 'অ্যাপয়েন্টমেন্ট', 'ডাক্তার',
      'কথা বলার', 'সময়', 'নিশ্চিত',
      // Bot name and brand (English within Bengali text)
      'Jessica', 'Future Health',
      // English fallbacks for hybrid bots
      'Hello', 'appointment', 'calling', 'health',
    ];
    const greetingBaselines = await captureBaselines(page, GREETING_PHRASES);

    console.log('[APPT-BN] Waiting up to 60s for first bot greeting...');
    const matchedGreeting = await waitForAnyNewOccurrence(page, GREETING_PHRASES, greetingBaselines, 60000);

    await sleep(1000);
    const actualGreeting = await getAllFramesText(page);
    console.log(`[APPT-BN] First greeting detected via phrase: "${matchedGreeting}"`);
    console.log(`[APPT-BN] Actual first greeting text: ${actualGreeting.slice(0, 500)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-greeting.png') }).catch(() => {});

    if (!matchedGreeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: First greeting', 'no greeting received', actualGreeting);
    }
    expect(matchedGreeting, 'Step 3: bot did not send a greeting').not.toBeNull();
    console.log('[APPT-BN] First greeting validated. Sending first Bengali message now.');

    // ── Step 4: Send "জি, অবশ্যই।" ───────────────────────────────────────────
    // Capture baselines for the second bot turn BEFORE sending.
    const STEP2_PHRASES = [
      // Expected: "ধন্যবাদ। আপনার জন্ম তারিখটি বলবেন?"
      'ধন্যবাদ', 'জন্ম তারিখ', 'তথ্য', 'নিশ্চিত',
      'বলবেন', 'দয়া করে', 'আপনার',
      // English fallbacks
      'date of birth', 'thank', 'confirm', 'please', 'information',
    ];
    const step2Baselines = await captureBaselines(page, STEP2_PHRASES);

    console.log('[APPT-BN] Sending first Bengali message: "জি, অবশ্যই।"');
    await sendMessage(page, 'জি, অবশ্যই।');
    console.log('[APPT-BN] First Bengali message sent — waiting up to 60s for second bot response.');

    // ── Step 5: Wait for second bot message ───────────────────────────────────
    const matchedStep2 = await waitForAnyNewOccurrence(page, STEP2_PHRASES, step2Baselines, 60000);

    await sleep(1000);
    const actualStep2 = await getAllFramesText(page);
    console.log(`[APPT-BN] Second bot response detected via phrase: "${matchedStep2}"`);
    console.log(`[APPT-BN] Actual second bot response text: ${actualStep2.slice(0, 500)}`);
    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-after-first-msg.png') }).catch(() => {});

    if (!matchedStep2) {
      await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-step2-fail.png') }).catch(() => {});
      logFailure('Step 5: Response after first Bengali message', 'no response received', actualStep2);
    }
    expect(matchedStep2, 'Step 5: bot did not respond after first Bengali message').not.toBeNull();
    console.log('[APPT-BN] Second bot response validated. Sending second Bengali message now.');

    // ── Step 6: Send "জি, আমি আসব।" ──────────────────────────────────────────
    // Capture baselines for the final bot turn BEFORE sending.
    // Use broad phrases — counts will increase beyond step-2 baselines when bot replies.
    const FINAL_PHRASES = [
      // Expected: "অ্যাপয়েন্টমেন্টের ব্যাপারে নিশ্চিত করার জন্য ধন্যবাদ! জন্ম তারিখটি বলতে পারবেন?"
      'ধন্যবাদ', 'অ্যাপয়েন্টমেন্ট', 'জন্ম তারিখ', 'তথ্য', 'নিশ্চিত',
      'সঠিক', 'বলতে পারবেন', 'দয়া করে',
      // Broader fallbacks
      'আপনার', 'ব্যাপারে', 'করার জন্য',
      // English fallbacks
      'appointment', 'thank', 'confirm', 'date of birth', 'information',
      'correct', 'please', 'verify',
    ];
    const finalBaselines = await captureBaselines(page, FINAL_PHRASES);

    console.log('[APPT-BN] Sending second Bengali message: "জি, আমি আসব।"');
    await sendMessage(page, 'জি, আমি আসব।');
    console.log('[APPT-BN] Second Bengali message sent — waiting up to 90s for final bot response.');

    // ── Step 7: Validate final bot response ───────────────────────────────────
    const matchedFinal = await waitForAnyNewOccurrence(page, FINAL_PHRASES, finalBaselines, 90000);

    await sleep(1000);
    const actualFinal = await getAllFramesText(page);
    console.log(`[APPT-BN] Final response detected via phrase: "${matchedFinal}"`);
    console.log(`[APPT-BN] Actual final bot response text: ${actualFinal.slice(0, 500)}`);

    if (!matchedFinal) {
      const dbg = await page.evaluate(() =>
        Array.from(document.querySelectorAll('*'))
          .map(el => (el.innerText || el.textContent || '').trim())
          .filter(t => t.length > 10)
          .slice(0, 30)
          .join(' | ')
      ).catch(() => '');
      console.log('[APPT-BN] DEBUG — visible page text nodes:', dbg.slice(0, 600));
    }

    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-after-second-msg.png') }).catch(() => {});

    if (!matchedFinal) {
      await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-final-fail.png') }).catch(() => {});
      logFailure('Step 7: Final response after second Bengali message', 'no response received', actualFinal);
    }
    expect(matchedFinal, 'Step 7: bot did not respond after second Bengali message').not.toBeNull();

    await page.screenshot({ path: join(REPORT_DIR, 'appt-bn-complete.png') }).catch(() => {});
    console.log('[APPT-BN] Test complete — Bengali appointment reminder multi-turn flow verified.');
  });
});
