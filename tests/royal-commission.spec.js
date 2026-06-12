import { test, expect } from '@playwright/test';
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AOORyTmV70SWWHX5GaAtEOjlg_62oAivArC0gT9PJ7fBDQumlZXauPSOzbYJPlZzGm9GaDWUWIb3RJW2GjG9x2DAdB6FYvttQmUDkrG_86chwzcqtCHfEgXWww1uI4TMBdw2hhuwp2RuQIS7-3w3WvuOfT2KI8uG8KcYNHB0IFst6qupSkuBxlOiIHqWZsklZqiuKmmQJVnO0Ag';

const REPORT_DIR = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'royal-commission-fail-report.csv');
const SCREENSHOTS_DIR = join(process.cwd(), 'test-results', 'royal-commission');

function csvEscape(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function logFailure(step, expectedPhrases, actualText) {
  const row = [
    new Date().toISOString(),
    step,
    expectedPhrases.join(' | '),
    actualText.slice(0, 400),
  ]
    .map(csvEscape)
    .join(',') + '\n';
  appendFileSync(REPORT_PATH, row);
}

async function send(page, input, text) {
  await input.fill(text);
  await page.getByRole('button').last().click();
}

async function getPageText(page) {
  return page.evaluate(() => {
    function collectText(root) {
      let text = '';
      for (const node of root.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent + ' ';
        else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.shadowRoot) text += collectText(node.shadowRoot);
          text += collectText(node);
        }
      }
      return text;
    }
    return collectText(document.body);
  });
}

async function assertPhrases(page, step, expectedPhrases) {
  let matched = false;
  for (const phrase of expectedPhrases) {
    const count = await page.getByText(new RegExp(phrase, 'i')).count();
    if (count > 0) {
      matched = true;
      console.log(`[PASS] "${step}": matched phrase "${phrase}"`);
      break;
    }
  }

  if (!matched) {
    const actualText = await getPageText(page);
    logFailure(step, expectedPhrases, actualText);
    const screenshotPath = join(SCREENSHOTS_DIR, `fail-${step}-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[FAIL] "${step}": none of [${expectedPhrases.join(' | ')}] found`);
    console.log(`[FAIL] Screenshot: ${screenshotPath}`);
  }

  expect(matched, `[${step}] Expected one of: [${expectedPhrases.join(' | ')}]`).toBe(true);
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
    await page.goto(BOT_URL);

    const chatButton = page.getByRole('button', { name: 'Text Chat' });
    await chatButton.waitFor({ timeout: 30000 });
    await chatButton.click();
    console.log('[INFO] Clicked "Text Chat" button');

    const input = page.getByRole('textbox');
    await input.waitFor({ timeout: 30000 });

    // Wait for the Arabic greeting to load before asserting
    console.log('[INFO] Waiting for Arabic greeting to load...');
    await page.waitForTimeout(8000);

    // Step 3: validate Arabic greeting
    await assertPhrases(page, 'greeting', [
      'هلا والله',
      'الهيئة الملكية',
      'الجزاءات',
    ]);

    // Step 4: send "Hello"
    console.log('[INFO] Sending "Hello"...');
    await send(page, input, 'Hello');
    await page.waitForTimeout(10000);

    // Step 5: validate response to "Hello"
    await assertPhrases(page, 'hello-response', [
      'Hello',
      'how can I help you today',
      'Royal Commission',
    ]);

    // Step 6: send "tell me about your services"
    console.log('[INFO] Sending "tell me about your services"...');
    await send(page, input, 'tell me about your services');
    await page.waitForTimeout(10000);

    // Step 7: validate services response
    await assertPhrases(page, 'services-response', [
      'Royal Commission for Jubail',
      'municipal violations and penalties',
      'violations',
    ]);

    console.log('[PASS] All steps completed successfully');
  });
});
