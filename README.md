# Company A · AI lead response and site-visit booking

Every enquiry gets an answer in seconds, in English, Hindi or Gujarati. Answers come only from the sales head's fact sheet. The assistant learns what the buyer wants, books a real free site-visit slot (it never double-books), and hands serious buyers to a named executive with a summary. Staff get one lead list across all sources with duplicate checks, today's visits with one-tap outcomes, and a dashboard of response time, visits, show-up rate and cost per visit by source.

- **Buyer:** `/` → pick a project → chat → pick a time → confirm → visit pass (map, calendar, change or cancel link)
- **Staff:** `/login` (demo logins in [deployment.md](deployment.md))

```
src/
  app/                 routes: buyer chat, visit page, staff screens, API
  lib/server/
    booking.ts         slots, holds, atomic capacity check, reminders
    leads.ts           intake from every source, duplicate rules, assignment
    ai/agent.ts        model loop with 4 tools, validated server-side
    ai/guardrails.ts   language, intent checks before the model, output check after
    chat.ts            buyer actions: message, pick slot, confirm, talk to a person
  lib/i18n.ts          buyer strings + SMS templates (EN/HI/GU)
prisma/                schema, migration (CHECK + partial unique index), seed
tests/                 46 tests against real Postgres
```

Setup, environment variables and deployment: **[deployment.md](deployment.md)**.
Design, data model, AI behaviour and trade-offs: see the Technical Design Document submitted with this repo.
