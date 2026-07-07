import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { sleep, navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { waitUntilCloudflareClears } from './helpers/cloudflare-helper.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor, screenshotStage } from './helpers/logging-helper.js';

const BOT_URL = 'https://demo.nextlevel.ai/custom/novo-nordisk';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('novo-nordisk-mental-health', REPORT_DIR);
const BUG_TITLE   = 'Novo Nordisk Mental Health bot greeting and response flow';
const TEST_NAME   = 'Novo Nordisk Mental Health bot greeting and response flow';

// Targets the named chat input to avoid strict-mode errors when multiple textboxes exist.
async function sendMessageMH(page, text, { inputWaitMs = 60000 } = {}) {
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

// Polls up to 60s for "Start New Session" or close variants. Scans <a> tags too
// (this site sometimes renders it as a link, not a button) — a capability the
// shared chat-launcher's button/role scan doesn't cover, so this stays local.
async function findAndClickStartSession(page) {
  const VARIATIONS = ['Start New Session', 'Start New', 'New Session', 'Session'];
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const roleBtn = page.getByRole('button', { name: /start new session/i }).first();
    if (await roleBtn.isVisible().catch(() => false)) {
      await roleBtn.scrollIntoViewIfNeeded().catch(() => {});
      console.log('[NOVO-MH] Found "Start New Session" via role locator.');
      await roleBtn.click();
      return true;
    }
    const clicked = await page.evaluate((variations) => {
      function scanRoot(root) {
        return Array.from(root.querySelectorAll('button,[role="button"],a')).find(el => {
          const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
          return variations.some(v => t.toLowerCase().includes(v.toLowerCase()));
        }) || null;
      }
      let el = scanRoot(document);
      if (!el) {
        for (const host of document.querySelectorAll('*')) {
          if (host.shadowRoot) { el = scanRoot(host.shadowRoot); if (el) break; }
        }
      }
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.click();
        return (el.innerText || el.textContent || '').trim();
      }
      return null;
    }, VARIATIONS).catch(() => null);
    if (clicked) { console.log(`[NOVO-MH] Found session button via DOM: "${clicked}"`); return true; }
    for (const v of VARIATIONS) {
      const el = page.getByText(v, { exact: false }).first();
      if (await el.isVisible().catch(() => false)) {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        console.log(`[NOVO-MH] Found session button via text locator: "${v}"`);
        await el.click();
        return true;
      }
    }
    await sleep(2000);
  }
  const vis = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button,[role="button"],a'))
      .map(b => (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim()).filter(Boolean)
  ).catch(() => []);
  console.log('[NOVO-MH] "Start New Session" NOT found after 60s. Visible elements:', vis);
  return false;
}

test.describe('Novo Nordisk Mental Health — Greeting and Response Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(240000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    console.log('[NOVO-MH] Navigating to Novo Nordisk Mental Health page...');
    await navigateTo(page, BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await screenshotStage(page, REPORT_DIR, 'novo-mh', 'startup');
    await waitUntilCloudflareClears(page, { prefix: '[NOVO-MH]', reportDir: REPORT_DIR });
    console.log('[NOVO-MH] Page loaded.');

    // ── Step 2: Scroll down ───────────────────────────────────────────────────
    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(1000);
    console.log('[NOVO-MH] Scrolled down.');
    await screenshotStage(page, REPORT_DIR, 'novo-mh', 'scrolled');

    // ── Step 3: Click "Start New Session" ────────────────────────────────────
    console.log('[NOVO-MH] Looking for "Start New Session" button (up to 60s)...');
    const preOpenText = await getAllFramesText(page);
    const sessionStarted = await findAndClickStartSession(page);
    if (!sessionStarted) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"],a'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      await screenshotStage(page, REPORT_DIR, 'novo-mh', 'start-btn-not-found');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 3: Start New Session', '"Start New Session" button not found', vis.join(', ')]);
      throw new Error('[NOVO-MH] "Start New Session" button not found after 60s. Visible: ' + vis.join(', '));
    }
    console.log('[NOVO-MH] "Start New Session" clicked.');
    await screenshotStage(page, REPORT_DIR, 'novo-mh', 'after-start');

    // ── Step 4: Wait for + validate greeting ──────────────────────────────────
    console.log('[NOVO-MH] Waiting up to 60s for bot greeting...');
    const greetingText = await waitForGreeting(page, {
      prefix: '[NOVO-MH]', reportDir: REPORT_DIR,
      baselineText: preOpenText, timeoutMs: 60000,
    });
    console.log('[NOVO-MH] Actual greeting text:', greetingText.slice(0, 500));
    await screenshotStage(page, REPORT_DIR, 'novo-mh', 'greeting');

    const greetingFail = await checkPhraseGroups(page, [
      { label: 'greeting acknowledgement', phrases: [
        'how are you feeling', 'how are you', 'How are you',
        'here for you', 'Here for you',
        'feeling today', 'Feeling today',
        'How can I help', 'how can I help',
        'welcome back', 'Welcome back',
        'Hello!', 'Hi!',
        'mental health', 'mental well',
        'support you', 'support today',
      ]},
    ]);
    if (greetingFail) {
      await screenshotStage(page, REPORT_DIR, 'novo-mh', 'greeting-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 4: Greeting', greetingFail, greetingText]);
    }
    expect(greetingFail, 'Step 4: bot did not send a greeting').toBeNull();
    console.log('[NOVO-MH] Greeting validated. Sending user message now.');

    // ── Step 5-6: Send "good" and validate response ───────────────────────────
    const preSendText = await getAllFramesText(page);
    const sentAt = Date.now();
    console.log(`[NOVO-MH] Sending: "good" at ${new Date(sentAt).toISOString()}`);
    await sendMessageMH(page, 'good');
    console.log('[NOVO-MH] Message sent — waiting up to 90s for bot response.');

    const responseText = await waitForBotResponse(page, {
      prefix: '[NOVO-MH]', reportDir: REPORT_DIR,
      baselineText: preSendText, sentText: 'good', timeoutMs: 90000,
    });
    console.log(`[NOVO-MH] Response received ${Date.now() - sentAt}ms after send`);
    console.log('[NOVO-MH] Actual bot response:', responseText.slice(0, 500));
    await screenshotStage(page, REPORT_DIR, 'novo-mh', 'after-good');

    const responseFail = await checkPhraseGroups(page, [
      { label: 'acknowledgement response', phrases: [
        'glad to hear', 'Glad to hear', 'great to hear', 'Great to hear',
        'good to hear', 'Good to hear', 'happy to hear', 'Happy to hear',
        'pleased to hear', 'Pleased to hear',
        'wonderful', 'Wonderful', 'excellent', 'Excellent',
        'fantastic', 'Fantastic', 'perfect', 'Perfect', 'awesome', 'Awesome',
        "that's great", "That's great", 'that is great', 'That is great',
        'tell me more', 'Tell me more', 'how long', 'How long',
        'can you share', 'can you tell', 'what else', 'What else',
        'would you like', 'Would you like',
        'how can I help', 'How can I help',
        'how can I support', 'How can I support',
        'what brings you', 'What brings you',
        'what would you', 'What would you',
        "let's talk", "Let's talk",
        'sounds like', 'Sounds like',
        'I understand', 'I hear you',
        'thank you for', 'Thank you for',
        "I'm glad", 'I am glad', "I'm happy", 'I am happy',
        'of course', 'Of course', 'certainly', 'Certainly',
        'absolutely', 'Absolutely', 'I see', 'noted', 'sure',
      ]},
    ]);
    if (responseFail) {
      await screenshotStage(page, REPORT_DIR, 'novo-mh', 'response-fail');
      logFailure(REPORT_PATH, [TEST_NAME, BUG_TITLE, 'Step 6: Bot response to "good"', responseFail, responseText]);
    }
    expect(responseFail, 'Step 6: bot did not respond to "good"').toBeNull();

    await screenshotStage(page, REPORT_DIR, 'novo-mh', 'complete');
    console.log('[NOVO-MH] Test complete — Novo Nordisk Mental Health greeting and response verified.');
  });
});
