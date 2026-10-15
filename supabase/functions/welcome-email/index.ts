/**
 * welcome-email: emails every new AceBudget account a link to open its budget.
 *
 * A database webhook calls this on each insert into public.acebudget_profiles
 * (one row is created per new account). It sends through Gmail over SMTP on
 * port 465: Supabase blocks outbound ports 25 and 587 from Edge Functions.
 *
 * Secrets (Supabase > Edge Functions > Secrets):
 *   GMAIL_USER          the Gmail address that sends, e.g. acebudget@gmail.com
 *   GMAIL_APP_PASSWORD  a Google app password for that address (not its login password)
 *   WEBHOOK_SECRET      any long random string; the webhook sends it in x-webhook-secret
 *   APP_URL             optional, defaults to https://ace-budget.vercel.app/
 */

import nodemailer from 'npm:nodemailer@6.9.16';

const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? '';
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') ?? '';
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://ace-budget.vercel.app/';

const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function welcomeMail(to: string) {
  const link = escapeHtml(APP_URL);
  const who = escapeHtml(to);
  return {
    from: `AceBudget <${GMAIL_USER}>`,
    to,
    subject: 'Welcome to AceBudget: your account is ready',
    text: [
      'Welcome to AceBudget!',
      '',
      `Your account (${to}) is ready. Open your budget and start adding your income, expenses and goals:`,
      APP_URL,
      '',
      'Sign in with this email and the password you chose. Your budget is saved to your account, so you can open it on any device.',
      '',
      'If you did not create this account, you can ignore this email.',
    ].join('\n'),
    html: `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f2f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#16211e">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #dde7e3;border-radius:16px">
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 12px;font-size:24px;color:#0b1a16">Welcome to AceBudget</h1>
        <p style="margin:0 0 16px;line-height:1.6">Your account (<strong>${who}</strong>) is ready. Open your budget and start adding your income, expenses and goals.</p>
        <p style="margin:0 0 24px">
          <a href="${link}" style="display:inline-block;padding:12px 22px;background:#0a7d5b;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">Open my budget</a>
        </p>
        <p style="margin:0 0 8px;line-height:1.6;color:#4b5f59;font-size:14px">Sign in with this email and the password you chose. Your budget is saved to your account, so you can open it on any device.</p>
        <p style="margin:0;line-height:1.6;color:#71857e;font-size:13px">If you did not create this account, you can ignore this email.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const email = payload?.type === 'INSERT' && payload?.table === 'acebudget_profiles' ? payload.record?.email : null;
  if (!email) return new Response('Ignored', { status: 200 });

  // Reply at once and send in the background: the webhook only waits a few
  // seconds, and Gmail can take longer than that to accept a message.
  const send = transport.sendMail(welcomeMail(email))
    .then(() => console.log('welcome email sent'))
    .catch((err: Error) => console.error('welcome email failed:', err.message));
  // @ts-ignore EdgeRuntime is provided by Supabase's runtime.
  EdgeRuntime.waitUntil(send);

  return new Response('Queued', { status: 202 });
});
