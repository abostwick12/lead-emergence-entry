import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const appOrigin = required('ENTRY_APP_ORIGIN');
const supabaseUrl = required('LOCAL_ENTRY_SUPABASE_URL');
const publishableKey = required('LOCAL_ENTRY_PUBLISHABLE_KEY');
const secretKey = required('LOCAL_ENTRY_SECRET_KEY');
const mailpitUrl = required('LOCAL_ENTRY_MAILPIT_URL');
const email = required('ENTRY_RECOVERY_TEST_EMAIL').toLowerCase();
const originalPassword = required('ENTRY_RECOVERY_OLD_PASSWORD');
const recoveredPassword = required('ENTRY_RECOVERY_NEW_PASSWORD');
if (!email.endsWith('.test')) throw new Error('Recovery acceptance is restricted to a reserved .test user');

const admin = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listed.error) throw listed.error;
const existing = listed.data.users.find((user) => user.email?.toLowerCase() === email);
const prepared = existing
  ? await admin.auth.admin.updateUserById(existing.id, { email, password: originalPassword, email_confirm: true, user_metadata: { synthetic_test: true, synthetic_test_purpose: 'entry_password_recovery' } })
  : await admin.auth.admin.createUser({ email, password: originalPassword, email_confirm: true, user_metadata: { synthetic_test: true, synthetic_test_purpose: 'entry_password_recovery' } });
if (prepared.error || !prepared.data.user) throw prepared.error ?? new Error('Recovery acceptance user unavailable');

async function recoveryLink() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=100`);
    if (!response.ok) throw new Error('Local recovery mailbox is unavailable');
    const summary = await response.json();
    const message = (summary.messages ?? []).find((item) => JSON.stringify(item).toLowerCase().includes(email));
    if (message?.ID) {
      const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${encodeURIComponent(message.ID)}`);
      if (!detailResponse.ok) throw new Error('Local recovery message could not be read');
      const detail = await detailResponse.json();
      const body = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`.replaceAll('&amp;', '&');
      const links = body.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
      const link = links.find((value) => value.includes('/auth/v1/verify') && value.includes('type=recovery'));
      if (link) {
        // Local GoTrue may render the Docker bridge address in Mailpit. Keep the
        // signed path/query intact while routing the browser through the public
        // local API address supplied by `supabase status`.
        const recoveryUrl = new URL(link);
        const publicLocalApi = new URL(supabaseUrl);
        recoveryUrl.protocol = publicLocalApi.protocol;
        recoveryUrl.host = publicLocalApi.host;
        return recoveryUrl.toString();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Recovery email was not delivered to the isolated local mailbox');
}

const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP localhost [::1]'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('fonts.googleapis.com')) errors.push(message.text());
});

try {
  await page.goto(`${appOrigin}/forgot-password`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(email);
  await Promise.all([
    page.waitForURL('**/forgot-password?sent=1', { timeout: 20_000 }),
    page.getByRole('button', { name: 'Send reset link' }).click(),
  ]);
  await page.getByRole('status').filter({ hasText: 'a reset link has been sent' }).waitFor();
  await page.goto(await recoveryLink(), { waitUntil: 'networkidle' });
  await page.waitForURL('**/update-password', { timeout: 30_000 });
  await page.getByLabel('New password').fill(recoveredPassword);
  await Promise.all([
    page.waitForURL('**/login?message=password_updated', { timeout: 20_000 }),
    page.getByRole('button', { name: 'Update password' }).click(),
  ]);
  await page.getByRole('status').filter({ hasText: 'password has been updated' }).waitFor();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(recoveredPassword);
  await Promise.all([
    page.waitForURL('**/workspaces', { timeout: 20_000 }),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  await page.getByRole('heading', { name: 'Where are you leading today?' }).waitFor();
  await page.screenshot({ path: 'test-results/entry-password-recovery.png', fullPage: true });

  const verifier = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const oldPassword = await verifier.auth.signInWithPassword({ email, password: originalPassword });
  assert(oldPassword.error, 'Original password remained valid after recovery');
  const newPassword = await verifier.auth.signInWithPassword({ email, password: recoveredPassword });
  if (newPassword.error) throw newPassword.error;
  await verifier.auth.signOut({ scope: 'local' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'PASS', recoveryEmailDelivered: true, callbackExchanged: true, passwordChanged: true, recoverySessionSignedOut: true, browserErrors: errors }));
} finally {
  await browser.close();
  const removed = await admin.auth.admin.deleteUser(prepared.data.user.id);
  if (removed.error) throw removed.error;
}
