import { expect, test } from '@playwright/test';
import { settled, signIn } from './phase11-kit';

/**
 * When something goes wrong in the browser: a screen that cannot load keeps the app's frame (so the person
 * can go elsewhere), and losing the internet is said at once.
 */
test('a screen that cannot load leaves the menu in place; no internet is said at once', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one browser is enough');
  await signIn(page);
  await settled(page);

  // The code of the Support screen is gone from the server (as after an update): the frame stays.
  await page.route(/\/assets\/SupportPage-[^/]+\.js$/, (route) => route.abort());
  await page.goto('/support');
  await expect(page.getByRole('alert')).toContainText(/new version is ready|stopped working/i);
  await expect(page.getByRole('button', { name: /reload/i })).toBeVisible();
  await expect(page.getByRole('navigation').first()).toBeVisible();
  // …and the next screen works: the crash belonged to that address only.
  await page
    .getByRole('link', { name: /^home$/i })
    .first()
    .click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();

  // The line goes down, and comes back.
  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: /no internet/i })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('status').filter({ hasText: /no internet/i })).toHaveCount(0);
});
