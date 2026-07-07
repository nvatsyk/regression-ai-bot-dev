import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { waitForGreeting } from './helpers/greeting-helper.js';
import { sendMessage } from './helpers/response-helper.js';
import { checkPhraseGroups, logFailure, reportPathFor } from './helpers/logging-helper.js';

const BOT_URL =
  'https://demo.nextlevel.ai/std/#config=G74AiORyTmV30UmJ5Pg7Qlsg0skB-29FLbACK2sLxAPNbQxBG52bbaH2hIym9j9l_FxcYzRGTYw8oIwcBGUE9EKLgppuWQhRek5NMjjCHn3jT0NrxyidcuUMum8erOAW6PAZgb0GUEH6FK0NSBDl_-9GV7_Dn4sjCLP-vGnmNbDrZjOC6gqqQlRHNohgciZRRJ4jDCNJIqshSoKLFg';

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = reportPathFor('dialogs', REPORT_DIR);

const dialogs = JSON.parse(
  readFileSync(join(process.cwd(), 'test-data', 'dialogs.json'), 'utf-8')
);

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
      await navigateTo(page, BOT_URL);
      await openChat(page, { prefix: `[${dialog.id}]`, labels: ['Text Chat'] });

      // Wait for bot greeting before sending any user message
      await waitForGreeting(page, { prefix: `[${dialog.id}]` });
      await expect(
        page.getByText(/Thank you for calling The Oven Cleaners|Ready to get a quote/i).first()
      ).toBeVisible({ timeout: 30000 });

      for (const message of dialog.messages) {
        await sendMessage(page, message);
      }

      // Validate: at least one expected phrase appears in the page
      const fail = await checkPhraseGroups(page, [
        { label: dialog.id, phrases: dialog.expected },
      ]);

      if (fail) {
        const actualText = await getAllFramesText(page);
        logFailure(REPORT_PATH, [
          dialog.id, dialog.description || '',
          dialog.messages[dialog.messages.length - 1],
          dialog.expected.join(' | '), actualText,
        ]);
      }

      expect(fail, `[${dialog.id}] Expected one of: [${dialog.expected.join(' | ')}]`).toBeNull();
    });
  }
});
