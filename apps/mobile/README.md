# Neoma Radio Mobile (Expo)

Production-oriented mobile app for the Radio/Newsroom experience, built for iOS + Android from one codebase.

## Stack

- Expo SDK 54 + React Native + TypeScript
- Expo Router
- Supabase auth (email OTP) + guest fallback
- TanStack Query for API state
- Zustand for local app state
- `expo-av` for sentence-level audio playback

## Features included

- Tech feed reading from `/api/newspaper?radio=feed`
- Philosophy feed support when that topic has real rows
- CEFR difficulty selection (A1-C2)
- Story list + completion status
- Sentence-by-sentence player
- Per-word gloss view (tap sentence card)
- Auto-play with configurable pause (0-500ms)
- Optional account sync via email OTP
- Bridge recap MCQ after each story (when present in API response)

## Deliberately omitted

- Admin ingest controls
- Technical debug payloads
- TTS debug UI
- Test/demo-only surfaces

## Setup

1. Install deps:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Fill `.env` values for `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
   - Keep `EXPO_PUBLIC_NEOMA_API_BASE_URL=https://neoma-plum.vercel.app` unless using a custom backend.

4. Run:

```bash
npm run start
```

## Deep link auth callback

- App scheme is `neoma://` (configured in `app.json`).
- OTP emails use `neoma://auth/callback` redirect.
- `AuthProvider` listens to incoming links and finalizes the session.

If OTP opens in browser only, copy/open the callback link on the device:

`neoma://auth/callback`

## Production builds

```bash
npx eas build --platform ios --profile production
npx eas build --platform android --profile production
```

After first successful build, configure submit IDs in `eas.json` and run:

```bash
npx eas submit --platform ios --profile production
npx eas submit --platform android --profile production
```

## App Store / Play Store release checklist

### Apple App Store

1. Create app in App Store Connect with bundle id `app.neoma.radio`.
2. Upload build from EAS and assign it to a new version.
3. Fill metadata:
   - Subtitle
   - Promotional text
   - Description
   - Keywords
   - Support URL
   - Marketing URL (optional)
4. Upload required screenshots:
   - 6.7" iPhone
   - 6.5" iPhone
   - 5.5" iPhone (optional but recommended)
5. Set privacy answers:
   - Account email (if signed in)
   - Usage data/analytics (only if added later)
6. Export compliance:
   - Non-exempt encryption = false (already set in `app.json`).
7. Submit for review.

### Google Play

1. Create app in Play Console with package `app.neoma.radio`.
2. Complete store listing:
   - Short description
   - Full description
   - Feature graphic
   - Phone screenshots
3. Complete Data safety form:
   - Account email data collected when user signs in.
4. Set content rating + target audience.
5. Upload AAB from EAS.
6. Start production rollout.

### Required assets (prepare now)

- App icon (1024x1024)
- Splash image
- At least 6 phone screenshots showing:
  - Feed
  - Difficulty/topic selection
  - Sentence player
  - Gloss view
  - Account sign-in
  - Bridge MCQ screen
