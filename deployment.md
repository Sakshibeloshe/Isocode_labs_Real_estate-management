# Deployment

Lead-response and site-visit booking assistant for Company A (Isocode Labs take-home).
Stack: Next.js 16 (App Router) · TypeScript · Tailwind 4 · PostgreSQL + Prisma 6 · Groq (Qwen) through an OpenAI-compatible API · Vitest.

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

**Vercel** (Next.js hosting) + **Neon** (serverless Postgres), both on free tiers. Use an India region where available (Neon `aws-ap-south-1` Mumbai; Vercel function region `bom1`).

1. Push the repo to GitHub, then **Import Project** in Vercel. Defaults are fine: the build command is `npm run build`, which runs `prisma generate` then `next build`.
2. In Vercel → Settings → Environment Variables, add the variables below.
3. From your machine, with `DATABASE_URL` pointing at the production database:

   ```bash
   npx prisma migrate deploy
   npm run db:seed
   ```

4. Deploy, then set `APP_URL` to the deployment URL so SMS links point to it, and redeploy.
5. Reminders: `vercel.json` registers a daily cron on `/api/cron/reminders`. The Hobby plan only allows daily crons, so due reminders are also dispatched whenever a staff page loads. In production, a 5-minute scheduler would call the same endpoint.

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
