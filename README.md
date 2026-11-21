# Clubhouse

Personal golf improvement PWA: swing video review, rounds, stats and practice plans.
Runs entirely on Cloudflare's free tier (Worker + static assets, D1, R2, Access).

## How it works

- **Swings.** Record or pick a clip on your phone. It's uploaded to R2, then MediaPipe pose runs **on the device**
  to find six positions (address, takeaway, top, transition, impact, finish), grab a frame of each and measure
  tempo, spine tilt, turn, lead arm and head movement.
- **Rounds.** Hole-by-hole quick entry (par, score, putts, fairway). GIR is derived.
- **Stats.** Scoring average, to-par, putts, fairways, GIR, penalties, par-type scoring.
- **Coach (off).** Haiku 5.5 for everyday feedback, Sonnet 5.5 only for a deeper review you ask for. No scheduled
  AI runs. Daily caps and cost rules live in `AI_RULES` in `worker/ai.ts`. Wired in as the final step.

## Outside services

Every outbound call goes through `worker/outbound.ts`: logged to `api_log` (Settings > Outside services > Call log),
paused after a 401/403/429/5xx or timeout so a broken source isn't hammered, and Nominatim is held to 1 request/s.

| Source | Used for | Limits we keep |
|---|---|---|
| GolfCourseAPI | pars, tees, yardages when you pick a course | 28 calls/day (free tier ~35), counted before sending; search cached 30 days, course card cached 1 year |
| OpenGolfAPI | name and nearby search | answers 403 from Workers today, so it pauses for 24 h after each 403 |
| OSM Nominatim | nearby and name search, city lookup | 1 request/s, results cached 7–90 days |
| OSM Overpass | hole pars for OSM courses | times out from Cloudflare; pauses 6 h per mirror |
| Zippopotam | ZIP to location | cached 90 days |

## Free-tier guards

- Videos and raw imports are deleted after the retention window (7 days default) by the daily cron.
- Uploads are refused when R2 would pass 90% of the free 10 GB.
- The cron also trims the call log (30 days) and stale lookup caches.
- Coming back to the app reloads a screen at most once a minute.

## Stack

| | |
|---|---|
| Frontend | React 19 + Vite, vite-plugin-pwa |
| API | Hono on a Cloudflare Worker (`worker/`) |
| Data | D1 (`migrations/`), R2 for video + keyframes |
| Pose | `@mediapipe/tasks-vision`, lazy-loaded, model cached by the service worker |
| Auth | Cloudflare Access in front of the whole hostname (not set up yet: the app is public until it is) |

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
