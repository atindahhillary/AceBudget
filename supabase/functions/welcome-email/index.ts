/**
 * welcome-email: AceBudget's account emails.
 *
 * A database webhook calls this on each insert into public.acebudget_emails
 * (see supabase/account-emails.sql). Each row is one email:
 *   kind 'welcome'  a new account → welcome email with a link to the app
 *   kind 'sign_in'  a sign-in     → "new sign-in to your account" email
 *
 * It sends through Gmail over SMTP on port 465: Supabase blocks outbound ports
 * 25 and 587 from Edge Functions.
 *
 * Secrets (Supabase > Edge Functions > Secrets):
 *   GMAIL_USER          the Gmail address that sends, e.g. acebudget@gmail.com
 *   GMAIL_APP_PASSWORD  a Google app password for that address (not its login password)
 *   WEBHOOK_SECRET      any long random string; the webhook sends it in x-webhook-secret
 *   APP_URL             optional, defaults to https://ace-budget.vercel.app/
 *   TIME_ZONE           optional, for sign-in times; defaults to Africa/Nairobi
 */

import nodemailer from 'npm:nodemailer@6.9.16';

const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? '';
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') ?? '';
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://ace-budget.vercel.app/';
const TIME_ZONE = Deno.env.get('TIME_ZONE') ?? 'Africa/Nairobi';

const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const greeting = (name?: string | null) => (name && name.trim() ? `Hi ${name.trim().split(/\s+/)[0]},` : 'Hi,');

/** The shared look of every AceBudget email: a white card with a green button. */
function layout(heading: string, paragraphs: string[], button: string, footnote: string) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f2f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#16211e">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #dde7e3;border-radius:16px">
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 12px;font-size:24px;color:#0b1a16">${heading}</h1>
        ${paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.6">${p}</p>`).join('\n        ')}
        <p style="margin:8px 0 24px">
          <a href="${escapeHtml(APP_URL)}" style="display:inline-block;padding:12px 22px;background:#0a7d5b;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">${button}</a>
        </p>
        <p style="margin:0;line-height:1.6;color:#71857e;font-size:13px">${footnote}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function welcomeMail(to: string, name?: string | null) {
  const hi = greeting(name);
  return {
    from: `AceBudget <${GMAIL_USER}>`,
    to,
    subject: 'Welcome to AceBudget: your account is ready',
    text: [
      hi,
      '',
      `Welcome to AceBudget! Your account (${to}) is ready. Open your budget and start adding your income, expenses and goals:`,
      APP_URL,
      '',
      'Sign in with this email and the password you chose. Your budget is saved to your account, so you can open it on any device.',
      '',
      'If you did not create this account, you can ignore this email.',
    ].join('\n'),
    html: layout(
      'Welcome to AceBudget',
      [
        escapeHtml(hi),
        `Your account (<strong>${escapeHtml(to)}</strong>) is ready. Open your budget and start adding your income, expenses and goals.`,
        '<span style="color:#4b5f59;font-size:14px">Sign in with this email and the password you chose. Your budget is saved to your account, so you can open it on any device.</span>',
      ],
      'Open my budget',
      'If you did not create this account, you can ignore this email.',
    ),
  };
}

function signInMail(to: string, name: string | null | undefined, at: string) {
  const hi = greeting(name);
  const when = new Date(at).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: TIME_ZONE, timeZoneName: 'short',
  });
  return {
    from: `AceBudget <${GMAIL_USER}>`,
    to,
    subject: 'New sign-in to your AceBudget account',
    text: [
      hi,
      '',
      `Your AceBudget account (${to}) was just signed in to on ${when}.`,
      '',
      `Open your budget: ${APP_URL}`,
      '',
      'If this was not you, open AceBudget, tap "Forgot password?" and choose a new password straight away.',
    ].join('\n'),
    html: layout(
      'New sign-in to AceBudget',
      [
        escapeHtml(hi),
        `Your AceBudget account (<strong>${escapeHtml(to)}</strong>) was just signed in to on <strong>${escapeHtml(when)}</strong>.`,
      ],
      'Open my budget',
      'If this was not you, open AceBudget, tap "Forgot password?" and choose a new password straight away.',
    ),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const record = payload?.type === 'INSERT' && payload?.table === 'acebudget_emails' ? payload.record : null;
  let mail = null;
  if (record?.email && record.kind === 'welcome') mail = welcomeMail(record.email, record.full_name);
  if (record?.email && record.kind === 'sign_in') mail = signInMail(record.email, record.full_name, record.created_at);
  if (!mail) return new Response('Ignored', { status: 200 });

  // Reply at once and send in the background: the webhook only waits a few
  // seconds, and Gmail can take longer than that to accept a message.
  const kind = record.kind === 'sign_in' ? 'sign-in' : 'welcome';
  const send = transport.sendMail(mail)
    .then(() => console.log(`${kind} email sent`))
    .catch((err: Error) => console.error(`${kind} email failed:`, err.message));
  // @ts-ignore EdgeRuntime is provided by Supabase's runtime.
  EdgeRuntime.waitUntil(send);

  return new Response('Queued', { status: 202 });
});
