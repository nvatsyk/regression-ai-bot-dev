import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sleep, navigateTo, checkAndHandleCloudflare, openChatWidget,
  waitForBotGreeting, waitForAnyNewOccurrence, sendMessage,
} from './helpers/browser-utils.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74ACORyTmV70SWWHX5GaAtEOjlg_62oBVZgZW2BeKC5jeHQ0e5lW6g9I7Ntgk-VPBgXGa3ZUGYR0mYOgzZDZqnFYcN0HIRi-m5D5XBE-vSNPx0Zrlm5FeGOOLAOdngLMXwm4K4h1JA9JXsDMsTF_7vB2nf880kMUT6cN8XMBo5uguMprOuYlCXxKiWyDk-pkmxRtuwoVlt5W5BYtAI';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');
const BUG_TITLE   = 'SPsoft BDR services flow';
const TEST_NAME   = 'SPsoft BDR services flow';

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

test.describe('SPsoft BDR — Services Flow', () => {
  test(TEST_NAME, async ({ page }) => {
    test.setTimeout(240000);
    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: Navigate ──────────────────────────────────────────────────────
    await navigateTo(page, BOT_URL);
    await checkAndHandleCloudflare(page, '[SPSOFT]', REPORT_DIR);
    await page.screenshot({ path: join(REPORT_DIR, 'spsoft-startup.png') }).catch(() => {});

    // Dismiss any "Got it" banner
    const gotItBtn = page.getByRole('button', { name: /got it/i });
    const hasGotIt = await gotItBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    if (hasGotIt) await gotItBtn.click().catch(() => {});
    await sleep(500);

    // ── Step 2: Capture baselines, open chat ──────────────────────────────────
    const greetingPhrases = ['Hello', 'Hi', 'welcome', 'name', 'your name', 'What is your name', 'help', 'assist', 'SPsoft', 'spsoft', 'Jessica', 'jessica', 'today'];
    const greetingBase = {};
    for (const p of greetingPhrases) {
      greetingBase[p] = await page.getByText(p, { exact: false }).count().catch(() => 0);
    }

    const chatOpened = await openChatWidget(page, {
      prefix: '[SPSOFT]',
      labels: ["Let's Chat", "Let's Chat", 'Text Chat', 'Chat', 'Start Chat', 'Start New Session'],
      failScreenshotPath: join(REPORT_DIR, 'spsoft-open-btn-not-found.png'),
    });
    if (!chatOpened) {
      const vis = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => (b.innerText || b.textContent || '').trim()).filter(Boolean)
      ).catch(() => []);
      throw new Error(`[SPSOFT] Chat button not found. Visible: ${vis.join(', ')}`);
    }
    console.log('[SPSOFT] Clicked chat button — waiting for greeting.');

    // ── Step 3: Wait for bot greeting ────────────────────────────────────────
    const greeting = await waitForBotGreeting(page, greetingPhrases, greetingBase, 70000);
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
    const step5Arrived = await waitForAnyNewOccurrence(page, step5Poll, step5Base, 70000);
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
    const step7Arrived = await waitForAnyNewOccurrence(page, step7Poll, step7Base, 70000);
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
