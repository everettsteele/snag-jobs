# Google OAuth Setup

The Google integration enables:
- **Calendar sync** — pull your Google Calendar events into Networking
- **Gmail drafts** — create drafts in Gmail from AI-generated outreach emails
- **Drive packages** (optional) — save application packages to Google Drive

## Prerequisites

You need a Google Cloud project. Free tier is fine.

## Step 1 — Create a Google Cloud Project

1. Go to https://console.cloud.google.com/
2. Click the project dropdown at the top, then **New Project**
3. Name it (e.g., `snag-tracker`) and click **Create**
4. Wait for creation, then select it as the active project

## Step 2 — Enable APIs

In your project, go to **APIs & Services → Library** and enable each of these:

- Google Calendar API
- Gmail API
- Google Drive API (if you want Drive packages)
- People API (optional, for profile photo)

## Step 3 — Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** (unless you have a Workspace org, then Internal is fine)
3. Fill in:
   - App name: `Snag` (or whatever you want users to see)
   - User support email: your email
   - Developer contact: your email
4. On the **Scopes** page, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/drive.file` (if using Drive)
5. On **Test users**, add your email (and any other accounts that will connect)
6. Save

> **Note:** These scopes include sensitive ones (gmail.readonly in particular).
> While in "Testing" status, only added test users can connect. That's fine for
> personal use. For production, you'd submit for Google verification (2–6 weeks).

## Step 4 — Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Snag Web Client`
5. **Authorized redirect URIs** — add both:
   - `http://localhost:3000/api/google/callback` (local dev)
   - `https://YOUR-RAILWAY-DOMAIN/api/google/callback` (production)
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

## Step 5 — Set Railway Environment Variables

In Railway → your service → **Variables**, add:

```
GOOGLE_CLIENT_ID=<from step 4>
GOOGLE_CLIENT_SECRET=<from step 4>
GOOGLE_REDIRECT_URI=https://YOUR-RAILWAY-DOMAIN/api/google/callback
```

For local development, put the same three in your `.env` file (with the
localhost redirect URI).

## Step 6 — Connect Your Account

1. Deploy (Railway will pick up the new env vars automatically)
2. In Snag, go to **Settings → Google Integration**
3. Click **Connect Google**
4. Sign in with your Google account (the one you added as a test user)
5. Grant the requested permissions
6. You'll be redirected back. Done.

You should now see "Connected as you@gmail.com" in Settings.

## Using the Integration

- **Events page → Sync Calendar** — pulls your last 14 days + next 30 days of events
- **Outreach card → Create Gmail Draft** — creates a draft in your Gmail
- **Calendar config** (future) — pick which calendars to sync

## Troubleshooting

**"Access blocked" when clicking Connect**
- Your email isn't in the test users list. Add it in the OAuth consent screen.

**"Redirect URI mismatch" error**
- The URI in your Railway env var must exactly match what you added in Credentials.
- Make sure it includes `/api/google/callback` at the end.
- No trailing slash.

**"Insufficient permissions" after connecting**
- You didn't grant one of the scopes. Go to
  https://myaccount.google.com/permissions, remove Snag, and reconnect.

**"Token expired" errors after a few hours**
- Normal. The backend uses the refresh token automatically. If it keeps failing,
  disconnect and reconnect in Settings.
