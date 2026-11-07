# QuoteFlow

RFQ-to-quote costing for an auto-component maker (take-home build for Isocode Labs, problem 5).
An estimator opens an RFQ with part details already read from the customer's email or Excel list,
costs each part at 2 or 3 volumes from one rate master, and the sales head approves large quotes.
Every saved quote remembers the exact rates it used.

- **Stack:** Next.js (App Router) and TypeScript, Postgres, plain CSS. No ORM; SQL is in `src/lib/services.ts`.
- **Costing is fixed formulas** in `src/lib/costing.ts`, never AI. AI/rules only pre-fill values, and nothing
  is trusted until the estimator accepts it.
- **Docs:** see `deployment.md` (run, deploy, demo logins) and the Technical Design Document.

## Quick start

```bash
npm install
cp .env.example .env            # then set SESSION_SECRET (openssl rand -hex 32)
docker compose up -d            # Postgres on :54329 (or: npm run db:local:start)
npm run db:reset                # create schema and demo data
npm run dev                     # http://localhost:3000
```

Demo users (password `Demo@1234`): `estimator@company-a.test`, `estimator2@company-a.test`,
`saleshead@company-a.test`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | 48 tests: costing engine, extraction, and services against a real Postgres |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:reset` | Drop and recreate the schema, then seed |
| `npm run db:local:start` / `stop` | Private Postgres inside `.pgdata` (needs server binaries, no sudo) |

## Layout

```
db/                schema.sql, migrate.ts, seed.ts, seed-data.ts
src/lib/costing.ts pure costing engine (no I/O)
src/lib/extract.ts RFQ email / Excel / title-block reader, optional LLM fallback
src/lib/services.ts business rules and queries
src/lib/pdf.ts     quote PDF
src/app/           screens and server actions
tests/             vitest
```
