# Accounts and cloud sync: setup notes

AceBudget stays local-first. Both the full app and the free sample work with no
account at all, and while signed out they make no network calls. Signing in is
optional and only adds a cloud backup so a household can open its budget on
another device.

## What is already done

- **Project:** the `amora` Supabase project (`tyaergniqnrntaubpgiz`, eu-central-1).
  AceBudget shares it rather than taking a second free-tier slot. Its tables are
  prefixed `acebudget_` and isolated by row level security.
- **Tables:**
  - `acebudget_profiles` (one row per user, holds `plan`: `free` or `full`)
  - `acebudget_states` (one row per user per app: `full` and `free` are separate)
- **Row level security:** every policy is `auth.uid() = user_id`. A signed-in
  user can only read and write their own rows. Verified: an anonymous caller
  holding the public key reads zero rows.
- **Signup trigger:** `acebudget_handle_new_user` creates the profile row
  automatically. `EXECUTE` is revoked so it is not callable over the REST API.
- **Client:** `src/core/supabase.js` talks to the REST endpoints with `fetch`.
  No npm package and no CDN script, matching the project's zero-dependency rule.

The publishable key in `src/core/supabase.js` is meant to be public. It grants
nothing on its own, because row level security does the actual protecting.

## Still to do (needs your accounts)

### 1. Allow the deployed URLs to redirect back

Supabase only redirects back to addresses on its allow-list. In
**Authentication > URL Configuration**, set the Site URL and add these redirect
URLs:

```
https://ace-budget.vercel.app/**
https://atindahhillary.github.io/AceBudget/**
http://localhost:5199/**
```

Email confirmation and password reset links, and Google sign-in, all depend on
this. Email and password sign-in works without it.

### 2. Turn on Google sign-in

The button is written and ready but hidden, so nobody meets a broken control.
To enable it:

1. In the Google Cloud console, create an **OAuth 2.0 Client ID** (type: Web
   application).
2. Add this authorised redirect URI:
   `https://tyaergniqnrntaubpgiz.supabase.co/auth/v1/callback`
3. In Supabase, **Authentication > Providers > Google**: enable it and paste the
   Client ID and Client Secret.
4. In `src/core/supabase.js`, change `GOOGLE_ENABLED` to `true` and redeploy.

### 3. Decide about the confirmation email

Email confirmation is currently **on**, so a new account has to click a link
before it can sign in. That is the safer default. If you would rather let people
in straight away, turn it off in **Authentication > Providers > Email**. The app
handles both: it shows "check your email" when confirmation is required.

Supabase's built-in email sender is rate limited and only really meant for
testing. For real users, connect your own SMTP under **Authentication > Emails**.

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
