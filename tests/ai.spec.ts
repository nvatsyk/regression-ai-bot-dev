import { test } from '@playwright/test';
const { askClaude } = require('../utils/claude');

test('AI test', async ({ page }) => {
  await page.goto('https://example.com');

  const result = await askClaude('Скажи привіт');

  console.log(result);
});