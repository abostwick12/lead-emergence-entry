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

test('hero controls remain clear and keyboard operable with enlarged text', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      const hero = document.querySelector<HTMLElement>('section[aria-labelledby="hero-title"]');
      if (!hero) throw new Error('Hero is missing');
      const text = [...hero.querySelectorAll<HTMLElement>('p, h1, a, button, li, span')];
      const sizes = text.map(element => Number.parseFloat(getComputedStyle(element).fontSize));
      text.forEach((element, index) => { element.style.fontSize = `${sizes[index] * 2}px`; });
    });

    const layout = await page.evaluate(() => {
      const hero = document.querySelector<HTMLElement>('[class*="heroPinned"]');
      const copy = document.querySelector<HTMLElement>('[class*="heroContent"]');
      const row = document.querySelector<HTMLElement>('[class*="motionControls"]');
      const buttons = row?.querySelector<HTMLElement>('div');
      if (!hero || !copy || !row || !buttons) throw new Error('Hero layout is missing');
      const bounds = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      return {
        rowWrap: getComputedStyle(row).flexWrap,
        buttonWrap: getComputedStyle(buttons).flexWrap,
        hero: bounds(hero),
        copy: bounds(copy),
        controls: [...row.querySelectorAll('a, button')].map(bounds),
      };
    });
    expect(layout.rowWrap).toBe('wrap');
    expect(layout.buttonWrap).toBe('wrap');
    expect(layout.controls[0].top).toBeGreaterThanOrEqual(layout.copy.bottom + 12);
    for (const control of layout.controls) {
      expect(control.left).toBeGreaterThanOrEqual(layout.hero.left);
      expect(control.right).toBeLessThanOrEqual(layout.hero.right);
      expect(control.bottom).toBeLessThanOrEqual(layout.hero.bottom);
    }

    const jump = page.getByRole('link', { name: /Scroll into the work/ });
    const watch = page.getByRole('button', { name: 'Watch the film' });
    const motion = page.getByRole('button', { name: /visual motion/ });
    await jump.focus();
    await expect(jump).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(watch).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(motion).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(motion).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Shift+Tab');
    await expect(watch).toBeFocused();
    await page.route('**/*.mp4', route => route.abort());
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /Lead Emergence/ })).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('the decision recommendation is announced as status when changed', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const status = page.getByRole('status');
  const requirement = page.getByRole('checkbox', { name: /decision ownership is non-negotiable/ });
  await expect(status).toContainText('MAYBE');
  await requirement.focus();
  await page.keyboard.press('Space');
  await expect(requirement).toBeChecked();
  await expect(status).toContainText('NO');
  await page.keyboard.press('Space');
  await expect(status).toContainText('MAYBE');
});

test('one public front door, concrete example, and no initial film request', async ({ page }, testInfo) => {
  const media: string[] = []; const errors: string[] = [];
  page.on('request', request => { if (request.url().includes('.mp4')) media.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Before you decide what to do,' })).toBeVisible();
  for (const link of await page.getByRole('link', { name: 'Sign In', exact: true }).all()) await expect(link).toHaveAttribute('href','/login');
  const authLinks = await page.locator('a[href="/login"]').count();
  expect(authLinks).toBeGreaterThanOrEqual(3);
  expect(await page.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')).filter(href => href?.includes('login') && href !== '/login'))).toEqual([]);
  expect(await page.locator('input[type="password"]').count()).toBe(0);
  await page.waitForTimeout(400);
  expect(media).toEqual([]);
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

test('scroll film seeks, pauses, and yields to ordinary scrolling', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, 90));
  if (testInfo.project.name === 'mobile') {
    await expect(page.locator('video[aria-hidden="true"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Watch the film' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Scroll into the work' }).click();
    await expect(page.getByRole('heading', { name: 'Everything starts with the leader.' })).toBeVisible();
    return;
  }
  const film = page.locator('video[aria-hidden="true"]');
  await expect(film).toHaveAttribute('data-ready','true');
  await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause visual motion' }).click();
  await page.waitForTimeout(150);
  const before = await film.evaluate((element: HTMLVideoElement) => element.currentTime);
  await page.evaluate(() => window.scrollBy(0, 100));
  await page.waitForTimeout(180);
  expect(await film.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(before,1);
  await page.getByRole('button', { name: 'Resume visual motion' }).click();
  await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Watch the film' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
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
  for (const name of ['SEE REALITY','REFRAME REALITY','ALIGN WITH REALITY','BUILD CAPABILITY','PRODUCE VALUE','NEW REALITY','SEE AGAIN']) await expect(list.getByText(name + ':', { exact: false })).toBeVisible();
  await list.scrollIntoViewIfNeeded();
  expect(media).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/*.mp4', route => route.abort());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.scrollTo(0, 100));
  await expect(page.locator('video[aria-hidden="true"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Before you decide what to do,' })).toBeVisible();
});

test('data saver keeps the poster during scroll', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
  const media: string[] = []; page.on('request', request => { if (request.url().includes('.mp4')) media.push(request.url()); });
  await page.goto('/'); await page.evaluate(() => window.scrollTo(0,100)); await page.waitForTimeout(250);
  expect(media).toEqual([]);
});
