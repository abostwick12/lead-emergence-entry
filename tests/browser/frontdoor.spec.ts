import { expect, test } from '@playwright/test';

test('public sign in uses the canonical Entry form and defaults to the chooser', async ({ page }) => {
  await page.goto('/');
  await page.locator('header').getByRole('link', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(1);
  await expect(page.locator('input[name="next"]')).toHaveValue('/workspaces');
  await expect(page.locator('input[type="password"]')).toHaveCount(1);
});

test('one public front door, concrete example, and looping hero film', async ({ page }, testInfo) => {
  const media: string[] = []; const errors: string[] = [];
  page.on('request', request => { if (request.url().includes('.mp4')) media.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Before you take the first step, you have to see where you're actually standing." })).toBeVisible();
  await expect(page.locator('[data-hero-description]')).toHaveText('Lead Emergence helps you be more present today, so you can see through the noise, separate signal from urgency, and notice what is actually happening.');
  await expect(page.getByText('Create the conditions for real value to grow.')).toHaveCount(0);
  await expect(page.getByText('PRODUCE VALUE', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Watch the film' })).toHaveCount(0);
  await expect(page.locator('dialog')).toHaveCount(0);
  for (const link of await page.getByRole('link', { name: 'Sign In', exact: true }).all()) await expect(link).toHaveAttribute('href','/login');
  const authLinks = await page.locator('a[href="/login"]').count();
  expect(authLinks).toBeGreaterThanOrEqual(3);
  expect(await page.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')).filter(href => href?.includes('login') && href !== '/login'))).toEqual([]);
  expect(await page.locator('input[type="password"]').count()).toBe(0);
  const film = page.locator('video[aria-hidden="true"]');
  await expect(film).toHaveAttribute('data-ready','true');
  await expect(film).toHaveJSProperty('loop', true);
  await expect(film).toHaveJSProperty('autoplay', true);
  await expect(film).toHaveJSProperty('muted', true);
  await expect(film).toHaveJSProperty('playsInline', true);
  expect(media.some(url => url.includes('lead-emergence-hero'))).toBe(true);
  await page.screenshot({ path: 'test-results/hero-' + testInfo.project.name + '.png' });
  // Jumping directly to useful content must not start a discarded hero download.
  await page.getByRole('checkbox', { name: /decision ownership is non-negotiable/ }).check();
  await expect(page.locator('[data-recommendation="NO"]')).toBeVisible();
  await page.getByRole('button', { name: 'ChatGPT', exact: true }).click();
  await expect(page.locator('[data-recommendation="NO"]')).toBeVisible();
  await page.getByRole('button', { name: 'Prepare the useful conversation' }).click();
  await expect(page.getByText('Which consequential decisions', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/example-' + testInfo.project.name + '.png' });
  expect(errors).toEqual([]);
});

test('looping hero updates stage copy and respects its pause control', async ({ page }, testInfo) => {
  await page.goto('/');
  if (testInfo.project.name === 'mobile') {
    const film = page.locator('video[aria-hidden="true"]');
    await expect(film).toHaveAttribute('data-ready','true');
    await expect(film).toHaveAttribute('src', /lead-emergence-hero-mobile\.mp4/);
    await page.getByRole('link', { name: 'Scroll into the work' }).click();
    await expect(page.getByRole('heading', { name: 'Everything starts with the leader.' })).toBeVisible();
    return;
  }
  const film = page.locator('video[aria-hidden="true"]');
  await expect(film).toHaveAttribute('data-ready','true');
  await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(.1);
  await film.evaluate((element: HTMLVideoElement) => new Promise<void>((resolve) => { element.addEventListener('seeked', () => resolve(), { once: true }); element.currentTime = element.duration * 4 / 7 + .02; }));
  await expect(page.getByText('CULTIVATE VALUE', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: "The work isn't only what we produce. It's what the work produces in us." })).toBeVisible();
  await expect(page.locator('[data-hero-description]')).toHaveText('Lead Emergence helps you notice value beyond the output: what the work is building in you, in other people, and in the systems around you.');
  const beforeScroll = await film.evaluate((element: HTMLVideoElement) => element.currentTime);
  await page.evaluate(() => window.scrollBy(0, 100));
  await page.waitForTimeout(180);
  expect(await film.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(beforeScroll);
  await page.getByRole('button', { name: 'Pause visual motion' }).click();
  await page.waitForTimeout(150);
  const before = await film.evaluate((element: HTMLVideoElement) => element.currentTime);
  await page.waitForTimeout(180);
  expect(await film.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(before,1);
  await page.getByRole('button', { name: 'Resume visual motion' }).click();
  await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(before);
  await page.getByRole('link', { name: 'Scroll into the work' }).click();
  await expect(page.getByRole('heading', { name: 'Everything starts with the leader.' })).toBeVisible();
});

test('reduced motion and blocked media preserve the complete story', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const media: string[] = [];
  page.on('request', request => { if (request.url().includes('.mp4')) media.push(request.url()); });
  await page.goto('/');
  const list = page.getByRole('list', { name: 'The seven-stage Lead Emergence progression' });
  await expect(list.getByRole('listitem')).toHaveCount(7);
  for (const name of ['SEE REALITY','REFRAME REALITY','ALIGN WITH REALITY','BUILD CAPABILITY','CULTIVATE VALUE','NEW REALITY','SEE AGAIN']) await expect(list.getByText(name + ':', { exact: false })).toBeVisible();
  for (const copy of [
    "Before you take the first step, you have to see where you're actually standing.",
    'Lead Emergence helps you be more present today, so you can see through the noise, separate signal from urgency, and notice what is actually happening.',
    "What if the problem isn't what you're seeing, but the framework you inherited?",
    'Lead Emergence helps you challenge the assumptions underneath your first conclusion, especially the ones you didn’t realize you were carrying, and start recognizing potential instead of only seeing problems.',
    "Alignment doesn't mean agreement. It means enough shared understanding to move together.",
    "Lead Emergence helps you connect what you're seeing with the people, priorities, and constraints around you so you can find what can actually move together.",
    'Clarity gives vision somewhere to go.',
    "Lead Emergence helps turn what you've learned into decisions, practices, and capabilities you can actually use.",
    "The work isn't only what we produce. It's what the work produces in us.",
    'Lead Emergence helps you notice value beyond the output: what the work is building in you, in other people, and in the systems around you.',
    "The goal was never the plan. It was a reality that didn't exist before.",
    'Lead Emergence helps you move from insight to change, so the way you lead, work, and live is actually different than it was before.',
    "Every new vantage point reveals what the old one couldn't.",
    'Lead Emergence helps you learn from what changed, see what is emerging now, and begin the process again from a different place.',
  ]) await expect(list.getByText(copy, { exact: false })).toBeVisible();
  await list.scrollIntoViewIfNeeded();
  expect(media).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/*.mp4', route => route.abort());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.scrollTo(0, 100));
  await expect(page.locator('video[aria-hidden="true"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: "Before you take the first step, you have to see where you're actually standing." })).toBeVisible();
});

test('data saver keeps the poster during scroll', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
  const media: string[] = []; page.on('request', request => { if (request.url().includes('.mp4')) media.push(request.url()); });
  await page.goto('/'); await page.evaluate(() => window.scrollTo(0,100)); await page.waitForTimeout(250);
  expect(media).toEqual([]);
});
