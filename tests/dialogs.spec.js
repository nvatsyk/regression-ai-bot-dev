import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AiORyTmV30UmJ5Pg7Qlsg0skB-29FLbACK2sLxAPNbQxBG52bbaH2hIym9j9l_FxcYzRGTYw8oIwcBGUE9EKLgppuWQhRek5NMjjCHn3jT0NrxyidcuUMum8erOAW6PAZgb0GUEH6FK0NSBDl_-9GV7_Dn4sjCLP-vGnmNbDrZjOC6gqqQlRHNohgciZRRJ4jDCNJIqshSoKLFg';

const REPORT_DIR = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'fail-report.csv');

const dialogs = JSON.parse(
  readFileSync(join(process.cwd(), 'test-data', 'dialogs.json'), 'utf-8')
);

function csvEscape(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function logFailure(dialog, actualText) {
  const row = [
    new Date().toISOString(),
    dialog.id,
    dialog.description || '',
    dialog.messages[dialog.messages.length - 1],
    dialog.expected.join(' | '),
    actualText.slice(0, 400),
  ]
    .map(csvEscape)
    .join(',') + '\n';
  appendFileSync(REPORT_PATH, row);
}

test.describe('Oven Cleaning Bot - Dialog Tests', () => {
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

      // Wait for bot greeting before sending any user message
      await expect(
        page.getByText(/Thank you for calling The Oven Cleaners|Ready to get a quote/i).first()
      ).toBeVisible({ timeout: 15000 });

      for (const message of dialog.messages) {
        await input.fill(message);
        await input.press('Enter');
        // wait for bot to finish responding before next message
        await page.waitForTimeout(10000);
      }

      // page.getByText() auto-pierces shadow DOM; body.innerText() does not
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
