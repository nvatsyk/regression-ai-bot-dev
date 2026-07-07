import { test, expect } from '@playwright/test';
import { navigateTo, getAllFramesText } from './helpers/browser-utils.js';
import { openChat } from './helpers/chat-launcher.js';
import { sendMessage, waitForBotResponse } from './helpers/response-helper.js';

const BOT_URL = 'https://demo.nextlevel.ai/std/#config=G74AiORyTmV30UmJ5Pg7Qlsg0skB-29FLbACK2sLxAPNbQxBG52bbaH2hIym9j9l_FxcYzRGTYw8oIwcBGUE9EKLgppuWQhRek5NMjjCHn3jT0NrxyidcuUMum8erOAW6PAZgb0GUEH6FK0NSBDl_-9GV7_Dn4sjCLP-vGnmNbDrZjOC6gqqQlRHNohgciZRRJ4jDCNJIqshSoKLFg';

test('chatbot works', async ({ page }) => {
  await navigateTo(page, BOT_URL);
  await openChat(page, { prefix: '[CHATBOT]', labels: ['Text Chat'] });

  const baseline = await getAllFramesText(page);
  await sendMessage(page, 'Hi');
  await waitForBotResponse(page, { prefix: '[CHATBOT]', baselineText: baseline, sentText: 'Hi' });

  // перевірка що бот відповів
  await expect(page.getByText(/thank you/i)).toBeVisible();
});
