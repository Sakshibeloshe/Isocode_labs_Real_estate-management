# Deployment

Lead-response and site-visit booking assistant for Company A (Isocode Labs take-home).

- **Live app:** https://isocode-labs-real-estate-management.vercel.app
- **Staff sign-in:** https://isocode-labs-real-estate-management.vercel.app/login
- **Code:** https://github.com/Sakshibeloshe/Isocode_labs_Real_estate-management

Stack: Next.js 16 (App Router) · TypeScript · Tailwind 4 · PostgreSQL + Prisma 6 · Groq (Qwen) through an OpenAI-compatible API · Vitest.

## Try it in 2 minutes

1. Open the live app → **Project 1** → **Start chat**.
2. Ask "When is possession?", then give a name and a 10-digit mobile and ask to visit → tap a time → **Confirm visit** → you get a visit pass with map, calendar file and change/cancel link.
3. Ask "What are the maintenance charges?" (not on the fact sheet) → handed to a named executive. Ask "Any discount?" → fixed reply + handoff.
4. Sign in at `/login` as `head@companya.test` → your test lead is under **Leads → Needs action**, its visit under **Visits**, its reminders under **Messages**, and the flags under **Review chats**.

## Demo logins

Password for every demo account: `demo1234`

| Role | Email | Sees |
|---|---|---|
| Sales executive | `priya@companya.test` | Own leads, handoffs, visits, dashboard, messages |
| Sales head (admin) | `head@companya.test` | Everything, plus fact sheet, slot editor, flagged-chat review, reassign, spend, erase |
| Other executives | `rohan@`, `aarti@`, `kunal@`, `neha@` `companya.test` | Same as Priya |

Buyers don't log in. Open `/` and pick a project, or go to `/chat`. A buyer's chat is tied to a secret cookie. Their visit is managed from the link in the confirmation (`/visit/<token>`).

Sample data is synthetic: about 95 leads over 6 weeks, including the three rows from the brief (LD-58210 Hardik Patel, LD-58211 Nidhi Shah, LD-58224 Kavita Joshi). Phone numbers use the `90000 xxxxx` range, emails use `example.com`, and RERA numbers are placeholders.

## Run locally

Needs **Node 20.9+**, a **PostgreSQL** database and a **Groq API key** (free at console.groq.com).

1. Install

   ```bash
   npm install
   ```

2. Database. Either:
   - **Neon (free, no install):** create a project at neon.tech and copy its connection string, or
   - **Docker:** `docker run --name leadassist-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16`
     → `postgresql://postgres:postgres@localhost:5432/postgres`

3. Environment

   ```bash
   cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
   ```

   Fill in `DATABASE_URL`, `SESSION_SECRET` and `LLM_API_KEY`. For `SESSION_SECRET` use any 32+ random characters:
   - macOS/Linux: `openssl rand -base64 32`
   - PowerShell: `[Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }))`

4. Create tables and load sample data

   ```bash
   npx prisma migrate deploy
   npm run db:seed
   ```

   `npm run db:seed -- --reset` wipes the app tables and reseeds. Use it on dev databases only; it refuses in production.

5. Start

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

### Tests

The tests run against a real Postgres, because the double-booking test needs real row locks. Point `TEST_DATABASE_URL` at a **separate, throwaway** database (a second Neon branch, or `createdb leadassist_test`). The tests truncate its tables.

```bash
npm test          # 46 tests: booking engine + concurrency, duplicates, guardrails, AI agent with a scripted model
npm run lint
npm run typecheck
```

### Use a different model (optional)

Any OpenAI-compatible endpoint works; change env only:

| Provider | `LLM_BASE_URL` | `LLM_MODEL` |
|---|---|---|
| Groq (default) | `https://api.groq.com/openai/v1` | `qwen/qwen3.8-27b` (or another tool-capable model listed in the Groq console) |
| Ollama (local, free) | `http://localhost:11434/v1` | `qwen3:8b` (`ollama pull qwen3:8b`; key can be empty) |

If the model is down, slow (over 10 s) or rate-limited, buyers see a short "leave your number" form, and the chat is flagged for the sales head. Nothing breaks.

## How it is deployed

| Piece | Where | Plan |
|---|---|---|
| App (pages, API, server actions) | **Vercel**, project `isocode-labs-real-estate-management`, deploys on every push to `main` | Hobby (free) |
| Database | **Neon** Postgres, AWS Asia Pacific (Singapore) `ap-southeast-1`, branch `production`, database `neondb` | Free |
| AI model | **Groq**, `qwen/qwen3.8-27b` | Free tier |
| Vercel function region | Singapore (`sin1`), next to the database | |

Steps taken (repeatable for a fresh deployment):

1. **Neon:** created the project in Singapore, the region closest to Ahmedabad that the free plan offered. Copied the connection string with **connection pooling off** (Prisma migrations need a direct connection).
2. **Database:** from a laptop, with that string as `DATABASE_URL` in `.env`:

   ```bash
   npx prisma migrate deploy   # creates tables + the capacity CHECK and one-live-visit index
   npm run db:seed             # demo data and logins (run once)
   ```

3. **Vercel:** imported the GitHub repo (preset Next.js; build command left as default, `npm run build`, which runs `prisma generate && next build`), then added the environment variables below with **Import .env**. `TEST_DATABASE_URL` is removed and `APP_URL` is set to the live URL.
4. Set **Settings → Functions → Region** to Singapore (`sin1`) and redeployed.
5. **Reminders:** `vercel.json` registers a daily cron on `/api/cron/reminders`, and Vercel sends `CRON_SECRET` as the bearer token. The Hobby plan only allows daily crons, so due reminders are also dispatched whenever a staff page loads. In production, a 5-minute scheduler would call the same endpoint.

Updating: push to `main` and Vercel rebuilds. A schema change needs `npx prisma migrate deploy` against Neon before (or with) the deploy.

### Environment variables (names only)

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `SESSION_SECRET` | yes | Signs staff session cookies (32+ chars) |
| `LLM_API_KEY` | yes | Groq API key |
| `LLM_BASE_URL` | no | OpenAI-compatible endpoint (default Groq) |
| `LLM_MODEL` | no | Model id (default `qwen/qwen3.8-27b`) |
| `LLM_TIMEOUT_MS` | no | Model timeout before fallback (default 10000) |
| `LLM_EXTRA_BODY` | no | JSON merged into each model request (provider-specific options) |
| `APP_URL` | yes in prod | Public URL used in SMS links |
| `CRON_SECRET` | yes in prod | Bearer token for `/api/cron/reminders` |
| `TEST_DATABASE_URL` | tests only | Throwaway database for `npm test` |
| `SEED_DEMO_PASSWORD` | no | Override the demo password when seeding |
| `DEMO_HINTS` | no | `false` hides demo logins on the sign-in page |

No secrets are committed: `.env*` is git-ignored except `.env.example`, which holds placeholders only.

## Notes

- Messages (SMS, reminders) are **simulated**: they are written to an outbox you can read under Staff → Messages, and on each lead.
- Portal and ad leads would arrive by forwarded email (Release 1 in the PRD). The demo uses **Add a lead** for that intake; the same duplicate check runs either way.
- Windows: if `npm install` is slow or files lock, the project folder may be inside OneDrive. Pause sync or move it outside OneDrive.
- **`P1001: Can't reach database server` locally:** some Indian ISPs (seen on Jio) refuse DNS lookups for `*.neon.tech`. Check with `Resolve-DnsName <host>`; if it says "DNS operation refused", switch the PC's DNS to `1.1.1.1` / `8.8.8.8` (or use a hotspot or Cloudflare WARP). The deployed app isn't affected.
- If the chat shows the "leave your number" form on every message, the Groq key is missing or invalid: check `LLM_API_KEY` and Vercel → Logs.
