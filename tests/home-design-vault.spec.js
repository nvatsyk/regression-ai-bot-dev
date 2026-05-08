import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AoORyTmV30SWW4-8IbZoCoE4O2H8raoEVSFvWFpAEFrjJRsBgtfrC2BPCTe1_yri4aMZocE3jPGB4fAgGByygRUHNtryEdnpOTcfgiKLoW38GWju4dMqVM5i-dSDBLTDhMwJ_DaCC9CmTDSgQ5f_vxtS_w1-IIwiz_rxZxmtgTxFFlyjqHWnCaSotqTqmdcfSaMFVRV0kquNyHFoA';

const REPORT_DIR = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'home-design-vault-fail-report.csv');

const dialogs = JSON.parse(
  readFileSync(join(process.cwd(), 'test-data', 'home-design-vault-dialogs.json'), 'utf-8')
);

function csvEscape(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
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

// Fill the textbox, try Enter first; if the value is still there, click the Send button.
async function sendMessage(page, text) {
  const input = page.getByRole('textbox');
  await input.waitFor({ timeout: 10000 });
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(500);
  const stillFilled = await input.inputValue().catch(() => '');
  if (stillFilled.trim() === text.trim()) {
    await page.getByRole('button').last().click();
  }
  await page.waitForTimeout(10000);
}

// Collect all visible text including shadow DOM for failure reporting.
async function collectPageText(page) {
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

test.describe('Home Design Vault - Dialog Tests', () => {
  test.beforeAll(() => {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(
      REPORT_PATH,
      'timestamp,dialog_id,description,last_user_message,expected_phrases,bot_response\n'
    );
  });

  for (const dialog of dialogs) {
    test(`[${dialog.id}] ${dialog.description || dialog.id}`, async ({ page }) => {
      test.setTimeout(240000);

      // ── Step 1: Open the bot ──────────────────────────────────────────────────
      await page.goto(BOT_URL);

      // ── Step 2: Click Text Chat ───────────────────────────────────────────────
      const chatButton = page.getByRole('button', { name: 'Text Chat' });
      await chatButton.waitFor({ timeout: 30000 });
      await chatButton.click();

      // ── Steps 3 & 4: Wait for and validate the greeting ──────────────────────
      // Every scenario must see "Hi, is that Artem?" before proceeding.
      const greeting = page.getByText(/is that Artem/i).first();
      await expect(greeting).toBeVisible({ timeout: 30000 });

      // ── Step 5: Confirm identity ──────────────────────────────────────────────
      await sendMessage(page, 'Yes');

      // ── Step 6: Wait for Jessica's intro from Home Design Vault ──────────────
      // "Jessica" only appears after the user confirms identity, so this is a
      // reliable marker that the intro has landed before scenario messages start.
      await expect(page.getByText(/Jessica/i).first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(3000);

      // ── Step 7: Run scenario-specific messages ────────────────────────────────
      for (const message of dialog.messages) {
        await sendMessage(page, message);
      }

      // After the final "Ok" the bot sends a closing confirmation. Give it extra
      // time to land so booking phrases (Monday, 2 PM, confirm) are visible.
      await page.waitForTimeout(6000);

      // ── Validate: at least one expected phrase appears in the page ────────────
      let matched = false;
      for (const phrase of dialog.expected) {
        const count = await page.getByText(new RegExp(phrase, 'i')).count();
        if (count > 0) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        const screenshotName =
          `home-design-vault-fail-${dialog.id.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.png`;
        await page.screenshot({ path: join(REPORT_DIR, screenshotName) }).catch(() => {});
        const actualText = await collectPageText(page);
        logFailure(dialog, actualText);
      }

      expect(
        matched,
        `[${dialog.id}] Expected one of: [${dialog.expected.join(' | ')}]`
      ).toBe(true);
    });
  }
});
