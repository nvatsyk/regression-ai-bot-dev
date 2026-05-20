import { test } from '@playwright/test';

test('open nextlevel', async ({ page }) => {
 await page.goto('https://demo.nextlevel.ai/');
});
