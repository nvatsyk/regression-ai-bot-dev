import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGGRlTmWfaQR57k5oOyDQyQH7b0UtsALM2nJJKNB0cjv8EFCalUR6rjkR2NT-p4xv409rsKYwD-iWZdAYMEOJgpppOQjF9JyaMjlBLvrGn06sHSydcuUMhm8erOAWGPAZgbsGUEH6lKwNyBDl_-_G0L7Dn48jCLP-vAn6DWwdONuReXQUCi1JokRWYilV4m1KdtPCuoIloMYSCw';

const REPORT_DIR = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'cosme-surge-fail-report.csv');

const dialogs = JSON.parse(
  readFileSync(join(process.cwd(), 'test-data', 'cosme-surge-dialogs.json'), 'utf-8')
);

function csvEscape(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

// CosmeSurge does not submit on Enter — click the send button (last button in widget DOM).
async function send(page, input, text) {
  await input.fill(text);
  await page.getByRole('button').last().click();
}

function logFailure(dialog, actualText) {
  const row = [
    new Date().toISOString(),
    dialog.id,
    dialog.description || '',
    dialog.messages[dialog.messages.length - 1] ?? '(no message)',
    dialog.expected.join(' | '),
    actualText.slice(0, 400),
  ]
    .map(csvEscape)
    .join(',') + '\n';
  appendFileSync(REPORT_PATH, row);
}

test.describe('Cosme Surge Bot - Dialog Tests', () => {
  test.beforeAll(() => {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(
      REPORT_PATH,
      'timestamp,dialog_id,description,last_user_message,expected_phrases,bot_response\n'
    );
  });

  for (const dialog of dialogs) {
    test(`[${dialog.id}] ${dialog.description || dialog.id}`, async ({ page }) => {
      await page.goto(BOT_URL);

      const chatButton = page.getByRole('button', { name: 'Text Chat' });
      await chatButton.waitFor({ timeout: 15000 });
      await chatButton.click();

      const input = page.getByRole('textbox');
      await input.waitFor({ timeout: 10000 });

      // Wait for the Arabic/CosmeSurge greeting to load before doing anything
      await page.waitForTimeout(8000);

      // If the first message is "Switch to English", send it and wait for English mode.
      // Do NOT click any text on the page — fill the textbox and click the send button.
      const messages = [...dialog.messages];
      if (messages[0] === 'Switch to English') {
        await send(page, input, messages.shift());
        await expect(
          page.getByText(/I understand|Hi there|Dana|CosmeSurge/i).first()
        ).toBeVisible({ timeout: 35000 });
      }

      // Send remaining dialog messages
      for (const message of messages) {
        await send(page, input, message);
        await page.waitForTimeout(10000);
      }

      // Validate expected phrases — getByText pierces shadow DOM
      let matched = false;
      for (const phrase of dialog.expected) {
        const count = await page.getByText(new RegExp(phrase, 'i')).count();
        if (count > 0) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        const actualText = await page.evaluate(() => {
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
        logFailure(dialog, actualText);
      }

      expect(
        matched,
        `[${dialog.id}] Expected one of: [${dialog.expected.join(' | ')}]`
      ).toBe(true);
    });
  }
});
