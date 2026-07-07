import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AoORyTmV30SWW4-8IbZoCoE4O2H8raoEVSFvWFpAEFrjJRsBgtfrC2BPCTe1_yri4aMZocE3jPGB4fAgGByygRUHNtryEdnpOTcfgiKLoW38GWju4dMqVM5i-dSDBLTDhMwJ_DaCC9CmTDSgQ5f_vxtS_w1-IIwiz_rxZxmtgTxFFlyjqHWnCaSotqTqmdcfSaMFVRV0kquNyHFoA';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('home-design-vault', REPORT_DIR);

const dialogs = JSON.parse(
  readFileSync(join(process.cwd(), 'test-data', 'home-design-vault-dialogs.json'), 'utf-8')
);

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

      // ── Step 1-2: Navigate + open chat ────────────────────────────────────────
      await navigateTo(page, BOT_URL);
      await openChat(page, { prefix: `[${dialog.id}]`, labels: ['Text Chat'] });

      // ── Steps 3 & 4: Wait for and validate the greeting ──────────────────────
      // Every scenario must see "Hi, is that Artem?" before proceeding.
      await waitForGreeting(page, { prefix: `[${dialog.id}]` });
      await expect(page.getByText(/is that Artem/i).first()).toBeVisible({ timeout: 30000 });

      // ── Step 5: Confirm identity ──────────────────────────────────────────────
      const confirmBaseline = await getAllFramesText(page);
      await sendMessage(page, 'Yes');

      // ── Step 6: Wait for Jessica's intro from Home Design Vault ──────────────
      // "Jessica" only appears after the user confirms identity, so this is a
      // reliable marker that the intro has landed before scenario messages start.
      await waitForBotResponse(page, { prefix: `[${dialog.id}]`, baselineText: confirmBaseline, sentText: 'Yes' });
      await expect(page.getByText(/Jessica/i).first()).toBeVisible({ timeout: 30000 });

      // ── Step 7: Run scenario-specific messages ────────────────────────────────
      for (const message of dialog.messages) {
        await sendMessage(page, message);
      }

      // ── Validate: at least one expected phrase appears in the page ────────────
      const fail = await checkPhraseGroups(page, [
        { label: dialog.id, phrases: dialog.expected },
      ]);

      if (fail) {
        const screenshotName =
          `home-design-vault-fail-${dialog.id.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.png`;
        await page.screenshot({ path: join(REPORT_DIR, screenshotName) }).catch(() => {});
        const actualText = await getAllFramesText(page);
        logFailure(REPORT_PATH, [
          dialog.id, dialog.description || '',
          dialog.messages[dialog.messages.length - 1] ?? '(no message)',
          dialog.expected.join(' | '), actualText,
        ]);
      }

      expect(fail, `[${dialog.id}] Expected one of: [${dialog.expected.join(' | ')}]`).toBeNull();
    });
  }
});
