# Public Domain Setup

Steps to put Snag on a public URL (e.g. `getsnag.app`, `snag.app`, or any domain you own).

## 1 — Register the domain

Buy the domain from any registrar (Namecheap, Porkbun, Cloudflare Registrar, Google Domains, etc.). Cloudflare is cheapest for `.app` TLDs and includes free DNS + SSL.

## 2 — Point DNS at Railway

1. In Railway, open your `meridian-recruiter-tracker` service → **Settings** → **Domains**
2. Click **+ Custom Domain**
3. Enter the domain you want (e.g. `getsnag.app` or `app.getsnag.app`)
4. Railway shows you a CNAME target like `xxx.up.railway.app`
5. At your DNS registrar:
   - **Apex domain** (`getsnag.app`): Use Railway's ALIAS/ANAME record if supported, or a CNAME flattening (Cloudflare supports this)
   - **Subdomain** (`app.getsnag.app`): Create a `CNAME` pointing `app` → `xxx.up.railway.app`
6. Wait 5-30 min for propagation. Railway will show a green checkmark when live, including SSL.

**Recommendation:** Use a subdomain like `app.getsnag.app` first. The apex can redirect to it or host a landing page later.

## 3 — Update Railway environment variables

Set these in Railway **Variables**:

```
APP_URL=https://app.getsnag.app
GOOGLE_REDIRECT_URI=https://app.getsnag.app/api/google/callback
CORS_ORIGINS=https://app.getsnag.app
```

`APP_URL` is used to build Stripe checkout return URLs and similar absolute links.

## 4 — Update Google OAuth

1. https://console.cloud.google.com/apis/credentials
2. Open your OAuth 2.0 Client
3. Under **Authorized redirect URIs**, add `https://app.getsnag.app/api/google/callback` (keep the Railway default one too, as a fallback)
4. Save

If you had the OAuth consent screen as "Testing" mode before, any new domain you add still only allows the test users you listed.

## 5 — Update Stripe webhook (if using billing)

1. https://dashboard.stripe.com/webhooks
2. Open your existing webhook
3. Change the URL to `https://app.getsnag.app/api/billing/webhook`
4. Save

## 6 — Update the Chrome extension

In `job-clip/options.html` the user enters the tracker URL. For your personal install, open the extension settings and paste the new domain (`https://app.getsnag.app`). No code changes needed.

## 7 — Verify

- Visit `https://app.getsnag.app` → should load the Snag login page over HTTPS with a green lock
- Log in with your existing credentials (JWT is domain-agnostic)
- Go to **Settings → Google Integration** → **Connect** → complete OAuth flow
- Check that Gmail draft / Calendar sync still work
- If you've set a Stripe Pro subscription, check billing status loads

## Optional: marketing site on root, app on subdomain

Once you're ready to launch publicly:
- Root domain `getsnag.app` → marketing site (Framer, Webflow, or a static Cloudflare Pages site)
- Subdomain `app.getsnag.app` → the Snag tracker (Railway)

The marketing site links to `app.getsnag.app/register` for signups.
