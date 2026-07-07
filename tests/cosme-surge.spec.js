import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AGGRlTmWfaQR57k5oOyDQyQH7b0UtsALM2nJJKNB0cjv8EFCalUR6rjkR2NT-p4xv409rsKYwD-iWZdAYMEOJgpppOQjF9JyaMjlBLvrGn06sHSydcuUMhm8erOAWGPAZgbsGUEH6lKwNyBDl_-_G0L7Dn48jCLP-vAn6DWwdONuReXQUCi1JokRWYilV4m1KdtPCuoIloMYSCw';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('cosme-surge', REPORT_DIR);

const dialogs = JSON.parse(
  readFileSync(join(process.cwd(), 'test-data', 'cosme-surge-dialogs.json'), 'utf-8')
);

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
      await navigateTo(page, BOT_URL);
      await openChat(page, { prefix: `[${dialog.id}]`, labels: ['Text Chat'] });

      // Wait for the Arabic/CosmeSurge greeting to load before doing anything
      await waitForGreeting(page, { prefix: `[${dialog.id}]` });

      // If the first message is "Switch to English", send it and wait for English mode.
      const messages = [...dialog.messages];
      if (messages[0] === 'Switch to English') {
        await sendMessage(page, messages.shift());
        await expect(
          page.getByText(/I understand|Hi there|Dana|CosmeSurge/i).first()
        ).toBeVisible({ timeout: 30000 });
      }

      // Send remaining dialog messages
      for (const message of messages) {
        await sendMessage(page, message);
      }

      // Validate expected phrases
      const fail = await checkPhraseGroups(page, [
        { label: dialog.id, phrases: dialog.expected },
      ]);

      if (fail) {
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
