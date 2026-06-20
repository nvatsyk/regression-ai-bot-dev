import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74ACORyTmV70SWWHX5GaAtEOjlg_62oBVZgZW2BeKC5jeHQ0e5lW6g9I7Ntgk-VPBgXGa3ZUGYR0mYOgzZDZqnFYcN0HIRi-m5D5XBE-vSNPx0Zrlm5FeGOOLAOdngLMXwm4K4h1JA9JXsDMsTF_7vB2nf880kMUT6cN8XMBo5uguMprOuYlCXxKiWyDk-pkmxRtuwoVlt5W5BYtAI';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'SPsoft BDR services flow';
const TEST_NAME   = 'SPsoft BDR services flow';

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

test.describe('SPsoft BDR — Services Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(240000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await page.goto(BOT_URL);

    // ── Step 2: Open chat ─────────────────────────────────────────────────────
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
      const found = await chatBtn.waitFor({ timeout: 50000 }).then(() => true).catch(() => false);
      if (!found) {
        const vis = await page.evaluate(() =>
          Array.from(document.querySelectorAll('button,[role="button"]'))
            .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
        ).catch(() => []);
        await page.screenshot({ path: join(REPORT_DIR, 'spsoft-open-btn-not-found.png') }).catch(() => {});
        throw new Error(`[SPSOFT] Chat button not found. Visible: ${vis.join(', ')}`);
      }
    }
    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-startup.png') }).catch(() => {});

    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // Capture baselines BEFORE clicking so greeting detection is accurate
    const greetingPhrases = ['Hello', 'Hi', 'welcome', 'name', 'your name', 'What is your name', 'help', 'assist', 'SPsoft', 'spsoft', 'Jessica', 'jessica', 'today'];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }
    await chatBtn.click();
    console.log('[SPSOFT] Clicked chat button — waiting for greeting.');

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greeting = await waitForBotGreeting(page, greetingPhrases, greetingBase, 50000);
    if (!greeting) {
      await page.screenshot({ path: join(REPORT_DIR, 'spsoft-greeting-fail.png') }).catch(() => {});
      logFailure('Step 3: Greeting', 'no greeting received', '');
    }
    expect(greeting, 'Step 3: bot did not send a greeting').toBeTruthy();
    console.log('[TEST] Greeting:', greeting);
    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-greeting.png') }).catch(() => {});

    // ── Step 4: Send "Natali" ─────────────────────────────────────────────────
    const step5Poll = [
      'Great', 'great', 'Nice', 'nice', 'Thanks', 'thank',
      'Natali', 'natali', 'meet', 'How can I help', 'how can I assist',
      'What can I help', 'SPsoft', 'services', 'help you', 'assist you',
    ];
    const step5Base = {};
    for (const p of step5Poll) {
      step5Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'Natali');
    console.log('[TEST] User message sent');

    // ── Step 5: Wait for any bot response ────────────────────────────────────
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 60000);
    if (!step5Arrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'spsoft-step5-fail.png') }).catch(() => {});
      logFailure('Step 5: Name acknowledgement', 'no bot response received', '');
    }
    expect(step5Arrived, 'Step 5: bot gave no response after sending name').toBeTruthy();
    console.log('[TEST] Bot response received:', step5Arrived);
    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-after-name.png') }).catch(() => {});

    // ── Step 6: Send "tell me about your services" ────────────────────────────
    const step7Poll = [
      'software', 'Software', 'development', 'Development', 'services', 'Services',
      'solution', 'Solution', 'technology', 'Technology', 'web', 'Web',
      'mobile', 'Mobile', 'cloud', 'Cloud', 'custom', 'Custom', 'AI', 'automation',
    ];
    const step7Base = {};
    for (const p of step7Poll) {
      step7Base[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    await sendMessage(page, 'tell me about your services');
    console.log('[SPSOFT] Sent "tell me about your services" — waiting for response.');

    // ── Step 7: Wait for services response ───────────────────────────────────
    const step7Arrived = await waitForAnyNewOccurrence(page, step7Poll, step7Base, 60000);
    if (!step7Arrived) {
      await page.screenshot({ path: join(REPORT_DIR, 'spsoft-services-fail.png') }).catch(() => {});
      logFailure('Step 7: Services response', 'no bot response received', '');
    }
    expect(step7Arrived, 'Step 7: bot gave no response to services question').toBeTruthy();
    console.log('[TEST] Bot response received:', step7Arrived);
    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-after-services.png') }).catch(() => {});

    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-complete.png') }).catch(() => {});
    console.log('[SPSOFT] Test complete — services response verified.');
  });
});
