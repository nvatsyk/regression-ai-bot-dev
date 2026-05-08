import { test, expect } from '@playwright/test';

const BOT_URL = 'https://demo.nextlevel.ai/std/#config=G74AiORyTmV30UmJ5Pg7Qlsg0skB-29FLbACK2sLxAPNbQxBG52bbaH2hIym9j9l_FxcYzRGTYw8oIwcBGUE9EKLgppuWQhRek5NMjjCHn3jT0NrxyidcuUMum8erOAW6PAZgb0GUEH6FK0NSBDl_-9GV7_Dn4sjCLP-vGnmNbDrZjOC6gqqQlRHNohgciZRRJ4jDCNJIqshSoKLFg';

test('chatbot works', async ({ page }) => {
  await page.goto(BOT_URL);

  // чекаємо появу кнопки
  const chatButton = page.getByRole('button', { name: 'Text Chat' });
  await chatButton.waitFor({ timeout: 15000 });

  await chatButton.click();

  // чекаємо інпут
  const input = page.getByRole('textbox');
  await input.waitFor({ timeout: 10000 });

  await input.fill('Hi');
  await input.press('Enter');

  // чекаємо відповідь
  await page.waitForTimeout(8000);

  // перевірка що бот відповів
  await expect(page.getByText(/thank you/i)).toBeVisible();
});