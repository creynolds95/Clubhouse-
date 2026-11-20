# Clubhouse

Personal golf improvement PWA: swing video review, rounds, stats and practice plans.
Runs entirely on Cloudflare's free tier (Worker + static assets, D1, R2, Access).

## How it works

- **Swings.** Record or pick a clip on your phone. It's uploaded to R2, then MediaPipe pose runs **on the device**
  to find six positions (address, takeaway, top, transition, impact, finish), grab a frame of each and measure
  tempo, spine tilt, turn, lead arm and head movement.
- **Rounds.** Hole-by-hole quick entry (par, score, putts, fairway). GIR is derived.
- **Stats.** Scoring average, to-par, putts, fairways, GIR, penalties, par-type scoring.
- **Coach (off).** Haiku 5.5 per-clip feedback and a weekly Sonnet 5.5 review + practice plan. Wired in as the
  final step; see `worker/ai.ts`.

## Stack

| | |
|---|---|
| Frontend | React 19 + Vite, vite-plugin-pwa |
| API | Hono on a Cloudflare Worker (`worker/`) |
| Data | D1 (`migrations/`), R2 for video + keyframes |
| Pose | `@mediapipe/tasks-vision`, lazy-loaded, model cached by the service worker |
| Auth | Cloudflare Access in front of the whole hostname |

## Local dev

```bash
npm install
npm run db:migrate:local
npm run dev            # http://localhost:5173, local D1 + R2 via the Cloudflare Vite plugin
```

## Deploy

Every push to `main` deploys via `.github/workflows/deploy.yml`. It creates the D1 database and R2 bucket if missing,
applies migrations, builds and runs `wrangler deploy`.

Repo secrets needed: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers template + D1 Edit +
Workers R2 Storage Edit). R2 must be enabled once in the Cloudflare dashboard (it asks for a card on file even on
the free tier).

### Lock it to you (Cloudflare Access)

1. Cloudflare dashboard → Zero Trust → Access → Applications → Add → Self-hosted.
2. Domain: `clubhouse.<your-subdomain>.workers.dev` (or your custom domain).
3. Policy: Allow, Include → Emails → your email. Login method: One-time PIN.

## Layout

```
shared/        types shared by app + worker
worker/        API (index.ts) and the coach interface (ai.ts)
src/lib/       api client, pose + keyframes, stats, settings, floater
src/screens/   one file per screen
src/components Shell (title bar, tabs, drawer, sidebar), Sheet, Icon
```

UX follows the interaction guide supplied with the project (one scroll container, tab bar as last flex item,
named back, sheets, floater for background work, honest empty/loading states).
