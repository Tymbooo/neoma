# Supabase + Google sign-in — checklist

Use this in order. Your **Supabase project ref** is in **Project Settings → General** (the subdomain in `https://REF.supabase.co`).

Replace **`YOUR_SITE`** with your real site (e.g. `https://exprobable.com` or your Vercel URL).

### If your ref is `vryzbzskpqowooeyrshw` — click these

| Step | Link |
|------|------|
| 1. SQL Editor | [Open SQL (new query)](https://supabase.com/dashboard/project/vryzbzskpqowooeyrshw/sql/new) |
| 4. Google provider | [Authentication → Providers](https://supabase.com/dashboard/project/vryzbzskpqowooeyrshw/auth/providers) |
| 5. URL config | [Authentication → URL configuration](https://supabase.com/dashboard/project/vryzbzskpqowooeyrshw/auth/url-configuration) |
| 6. API keys | [Project Settings → API](https://supabase.com/dashboard/project/vryzbzskpqowooeyrshw/settings/api) |
| Ref / name | [Project Settings → General](https://supabase.com/dashboard/project/vryzbzskpqowooeyrshw/settings/general) |

**Google OAuth redirect URI (exact):**  
`https://vryzbzskpqowooeyrshw.supabase.co/auth/v1/callback`

---

Below, **`REF`** = your ref if different from above. Replace `REF` in URLs if needed.

---

## 1. Create the database table (profiles)

**Where:** [Supabase SQL Editor — new query](https://supabase.com/dashboard/project/REF/sql/new)  
(Replace `REF` in the URL, then open it.)

1. Click **New query**.
2. Paste the SQL from **`supabase/migrations/001_profiles.sql`** in this repo (everything from `create table` through the last line), **or** copy from that file in Cursor/Finder.
3. Click **Run**. Fix any error before continuing.

---

## 2. Google Cloud — OAuth consent screen (once per project)

**Where:** [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)

1. Pick your Google Cloud project (top bar).
2. User type **External** (unless you use Workspace only).
3. Fill app name, support email, developer email → **Save and continue**.
4. Scopes: defaults are fine → **Save and continue**.
5. Test users: add **your Gmail** if the app is in “Testing” → **Save**.

---

## 3. Google Cloud — OAuth client (Web)

**Where:** [Credentials — Create OAuth client](https://console.cloud.google.com/apis/credentials)

1. **Create credentials** → **OAuth client ID**.
2. Type: **Web application**. Name: e.g. `Neoma`.
3. **Authorized JavaScript origins** — **Add URI**:
   - `http://localhost:3000`
   - `YOUR_SITE` (no path; e.g. `https://exprobable.com`)
4. **Authorized redirect URIs** — **Add URI** (must match Supabase exactly):

   `https://REF.supabase.co/auth/v1/callback`

   Example: `https://vryzbzskpqowooeyrshw.supabase.co/auth/v1/callback`

5. **Create** → copy **Client ID** and **Client secret** (you’ll paste them in step 4).

---

## 4. Supabase — Enable Google provider

**Where:** [Authentication → Providers → Google](https://supabase.com/dashboard/project/REF/auth/providers)

1. Open **Google**.
2. Turn **Enable sign in with Google** **ON**.
3. Paste **Client ID** and **Client secret** from step 3 → **Save**.

---

## 5. Supabase — Site URL and redirect URLs

**Where:** [Authentication → URL configuration](https://supabase.com/dashboard/project/REF/auth/url-configuration)

1. **Site URL** → set to **`YOUR_SITE`** (the main URL users use).
2. **Redirect URLs** → **Add URL** for each:
   - `YOUR_SITE` (same as Site URL)
   - `http://localhost:3000`
   - Any Vercel preview URLs you use (e.g. `https://neoma-git-main-xxx.vercel.app`)

Save.

---

## 6. Vercel — Environment variables

**Where:** [Vercel — Dashboard](https://vercel.com/dashboard) → your **Neoma** project → **Settings** → **Environment Variables**

Get values from Supabase:

**Where:** [Project Settings → API](https://supabase.com/dashboard/project/REF/settings/api)

Add:

| Name | Value |
|------|--------|
| `SUPABASE_URL` | **Project URL** (e.g. `https://REF.supabase.co`) |
| `SUPABASE_ANON_KEY` | **anon public** key |

Enable for **Production** (and **Preview** / **Development** if you want). **Save**, then **Deployments** → **⋯** on latest → **Redeploy**.

**Local:** same two variables in repo root **`.env.local`** for `npx vercel dev`.

---

## 7. Smoke test

1. Open **`YOUR_SITE`** (or `http://localhost:3000` with `vercel dev`).
2. You should see **Sign in with Google** on the home page.
3. Sign in → **Choose a username** → Save.

If the auth bar is missing: config isn’t reaching the browser — check step 6 and redeploy.

---

## Quick reference links (replace `REF`)

| Task | Link |
|------|------|
| SQL Editor | `https://supabase.com/dashboard/project/REF/sql/new` |
| Auth providers | `https://supabase.com/dashboard/project/REF/auth/providers` |
| URL configuration | `https://supabase.com/dashboard/project/REF/auth/url-configuration` |
| API keys / URL | `https://supabase.com/dashboard/project/REF/settings/api` |
| General (find Reference ID) | `https://supabase.com/dashboard/project/REF/settings/general` |

**Google**

| Task | Link |
|------|------|
| Credentials | https://console.cloud.google.com/apis/credentials |
| OAuth consent | https://console.cloud.google.com/apis/credentials/consent |

**Repo**

| File | GitHub (main) |
|------|----------------|
| SQL migration | https://github.com/Tymbooo/neoma/blob/main/supabase/migrations/001_profiles.sql |
