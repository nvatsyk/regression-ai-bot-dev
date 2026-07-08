import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AOORyTmV70SWWHX5GaAtEOjlg_62oAivArC0gT9PJ7fBDQumlZXauPSOzbYJPlZzGm9GaDWUWIb3RJW2GjG9x2DAdB6FYvttQmUDkrG_86chwzcqtCHfEgXWww1uI4TMBdw2hhuwp2RuQIS7-3w3WvuOfT2KI8uG8KcYNHB0IFst6qupSkuBxlOiIHqWZsklZqiuKmmQJVnO0Ag';

const REPORT_DIR = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('royal-commission', REPORT_DIR);
const SCREENSHOTS_DIR = join(process.cwd(), 'test-results', 'royal-commission');

async function assertPhrases(page, step, expectedPhrases) {
  const fail = await checkPhraseGroups(page, [{ label: step, phrases: expectedPhrases }]);

  if (fail) {
    const actualText = await getAllFramesText(page);
    logFailure(REPORT_PATH, [step, expectedPhrases.join(' | '), actualText]);
    const screenshotPath = join(SCREENSHOTS_DIR, `fail-${step}-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[FAIL] "${step}": none of [${expectedPhrases.join(' | ')}] found`);
    console.log(`[FAIL] Screenshot: ${screenshotPath}`);
  } else {
    console.log(`[PASS] "${step}": matched an expected phrase`);
  }

  expect(fail, `[${step}] Expected one of: [${expectedPhrases.join(' | ')}]`).toBeNull();
}

// Arabic tashkeel (diacritics) get inserted inconsistently by the bot across
// runs (e.g. "الملكية" vs "المَلَكية" for the same word), which breaks a plain
// substring match. Strip them before comparing so wording checks aren't
// sensitive to vowel-marking the bot varies at random.
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const stripArabicDiacritics = s => s.normalize('NFC').replace(ARABIC_DIACRITICS, '');

async function assertArabicPhrases(page, step, expectedPhrases) {
  const actualText = await getAllFramesText(page);
  const normalizedText = stripArabicDiacritics(actualText);
  const matched = expectedPhrases.some(p => normalizedText.includes(stripArabicDiacritics(p)));

  if (!matched) {
    logFailure(REPORT_PATH, [step, expectedPhrases.join(' | '), actualText]);
    const screenshotPath = join(SCREENSHOTS_DIR, `fail-${step}-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[FAIL] "${step}": none of [${expectedPhrases.join(' | ')}] found (diacritic-insensitive)`);
    console.log(`[FAIL] Screenshot: ${screenshotPath}`);
  } else {
    console.log(`[PASS] "${step}": matched an expected phrase (diacritic-insensitive)`);
  }

  expect(matched, `[${step}] Expected one of (diacritic-insensitive): [${expectedPhrases.join(' | ')}]`).toBe(true);
}

test.describe('KSA (Najdi) Royal Commission Q&A [Bilingual] - Regression', () => {
  test.beforeAll(() => {
    mkdirSync(REPORT_DIR, { recursive: true });
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    writeFileSync(REPORT_PATH, 'timestamp,step,expected_phrases,actual_text\n');
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const screenshotPath = join(SCREENSHOTS_DIR, `fail-afterEach-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await testInfo.attach('failure-screenshot', {
        path: screenshotPath,
        contentType: 'image/png',
      });
      console.log(`[FAIL] afterEach screenshot: ${screenshotPath}`);
    }
  });

  test('greeting → Hello → services flow', async ({ page }) => {
    console.log('[INFO] Navigating to Royal Commission bot...');
    await navigateTo(page, BOT_URL);
    await openChat(page, {
      prefix: '[ROYAL]',
      reportDir: REPORT_DIR,
      labels: ['Text Chat', 'Chat', 'Start Chat'],
      timeoutMs: 60000,
    });
    console.log('[INFO] Clicked "Text Chat" button');

    console.log('[INFO] Waiting for Arabic greeting to load...');
    await waitForGreeting(page, { prefix: '[ROYAL]', reportDir: REPORT_DIR });

    // Step 3: validate Arabic greeting
    await assertArabicPhrases(page, 'greeting', [
      'هلا والله',
      'الهيئة الملكية',
      'الجزاءات',
      'المخالفات',
      'الغرامات',
      'اللائحة',
    ]);

    // Step 4-5: send "Hello" and validate response
    console.log('[INFO] Sending "Hello"...');
    const helloBaseline = await getAllFramesText(page);
    await sendMessage(page, 'Hello');
    await waitForBotResponse(page, {
      prefix: '[ROYAL]', reportDir: REPORT_DIR,
      baselineText: helloBaseline, sentText: 'Hello', timeoutMs: 45000,
    });
    await assertPhrases(page, 'hello-response', [
      'Hello',
      'how can I help you today',
      'Royal Commission',
    ]);

    // Step 6-7: send "tell me about your services" and validate response
    console.log('[INFO] Sending "tell me about your services"...');
    const servicesBaseline = await getAllFramesText(page);
    await sendMessage(page, 'tell me about your services');
    await waitForBotResponse(page, {
      prefix: '[ROYAL]', reportDir: REPORT_DIR,
      baselineText: servicesBaseline, sentText: 'tell me about your services', timeoutMs: 60000,
    });
    await assertPhrases(page, 'services-response', [
      'Royal Commission for Jubail',
      'municipal violations and penalties',
      'violations',
    ]);

    console.log('[PASS] All steps completed successfully');
  });
});
