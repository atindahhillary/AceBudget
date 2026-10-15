# Accounts and cloud sync: setup notes

AceBudget stays local-first. Both the full app and the free sample work with no
account at all, and while signed out they make no network calls. Signing in is
optional and only adds a cloud backup so a household can open its budget on
another device.

## The Supabase project

AceBudget shares the `amora` Supabase project (`tyaergniqnrntaubpgiz`,
eu-central-1) rather than taking a second free-tier slot. Its tables are
prefixed `acebudget_` and isolated by row level security.

**Shared settings:** email confirmation, the SMTP sender and the email rate
limits are project-wide, so the choices below apply to amora's sign-up too.

The tables are recorded in [`supabase/schema.sql`](../supabase/schema.sql):

- **Tables:**
  - `acebudget_profiles` (one row per user, holds `plan`: `free` or `full`)
  - `acebudget_states` (one row per user per app: `full` and `free` are separate)
- **Row level security:** a signed-in user can only read and write their own
  rows. An anonymous caller holding the public key reads nothing.
- **Signup trigger:** `acebudget_handle_new_user` creates the profile row for
  every new account. `EXECUTE` is revoked so it is not callable over the REST API.

The client is `src/core/supabase.js`, which talks to the REST endpoints with
`fetch`: no npm package and no CDN script. Its publishable key is meant to be
public; row level security does the protecting.

## Sign-up: straight in, then a welcome email

- **Email confirmation is off.** A new account is signed in the moment it is
  created, so nobody waits on an email to get in. The trade-off: addresses are
  not verified.
- Because sign-up sends no confirmation email, it never shows Supabase's
  "For security purposes, you can only request this after N seconds" message.
  That throttle now only applies to **Forgot password?**, and its interval is
  set to the minimum (step 4 below).
- **A welcome email** with an "Open my budget" button is sent to every new
  account by the `welcome-email` Edge Function
  ([`supabase/functions/welcome-email`](../supabase/functions/welcome-email/index.ts)),
  through Gmail. A database webhook calls it on each new `acebudget_profiles` row.

## Dashboard steps (in the amora project)

1. **Turn off confirmation.** Authentication > Sign In / Providers > Email:
   switch **Confirm email** off and save.
2. **Allow the app's addresses.** Authentication > URL Configuration: Site URL
   `https://ace-budget.vercel.app`, and add these redirect URLs (password reset
   links and Google sign-in need them):

   ```
   https://ace-budget.vercel.app/**
   https://atindahhillary.github.io/AceBudget/**
   http://localhost:5199/**
   ```
3. **Gmail app password.** On the sending Google account: turn on 2-Step
   Verification, then myaccount.google.com/apppasswords > create one named
   `AceBudget`. Gmail sends up to about 500 emails a day this way.
4. **Send auth emails through Gmail too.** Authentication > Emails > SMTP
   Settings: enable custom SMTP with host `smtp.gmail.com`, port `465`,
   username = the Gmail address, password = the app password, sender name
   `AceBudget`. Then set **Minimum interval between emails** to the lowest
   value it accepts. This lifts the built-in sender's limit of a few emails an
   hour for password resets.
5. **Deploy the welcome email.** Edge Functions > Deploy a new function > Via
   editor, name it `welcome-email`, paste `supabase/functions/welcome-email/index.ts`,
   turn **off** "Verify JWT" (the function checks its own secret instead), deploy.
   Then Edge Functions > Secrets, add `GMAIL_USER`, `GMAIL_APP_PASSWORD` and
   `WEBHOOK_SECRET` (any long random string).
6. **Call it on every new account.** Database > Webhooks > Create: name
   `welcome-email`, table `acebudget_profiles`, event **Insert**, type
   **Supabase Edge Functions**, function `welcome-email`, timeout 5000 ms, and
   add an HTTP header `x-webhook-secret` with the same value as `WEBHOOK_SECRET`.

## Turn on Google sign-in (optional)

The button is written and ready but hidden, so nobody meets a broken control.

1. In the Google Cloud console, create an **OAuth 2.0 Client ID** (type: Web
   application).
2. Add this authorised redirect URI:
   `https://tyaergniqnrntaubpgiz.supabase.co/auth/v1/callback`
3. In Supabase, **Authentication > Providers > Google**: enable it and paste the
   Client ID and Client Secret.
4. In `src/core/supabase.js`, change `GOOGLE_ENABLED` to `true` and redeploy.

## How syncing behaves

- Local storage stays the source of truth; the cloud copy is a mirror.
- A local edit is pushed about 1.5 seconds after the last keystroke, and again
  when the tab closes if something was still pending.
- On sign-in and on load, whichever copy has the newer `updatedAt` wins.
- **Known limit:** this is last-write-wins, not a merge. If the same household
  edits on two devices while offline, the later save replaces the earlier one
  rather than combining them.

## Paid gating

`acebudget_profiles.plan` exists for this and defaults to `free`. Nothing reads
it yet. The full app is still open to anyone with the link, so the plan column
is where a future paywall would hang, alongside a payment provider and a server
side check.
