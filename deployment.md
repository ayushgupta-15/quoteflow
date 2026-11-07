# QuoteFlow: running, deploying and trying it

- **GitHub:** {{REPO_URL}}
- **Live app:** {{LIVE_URL}}

## Demo logins (for the reviewer)

All three users share one demo password: `Demo@1234`. They exist only in the demo data.

| Role | Email | Can do |
| --- | --- | --- |
| Estimator | `estimator@company-a.test` | Create RFQs, cost parts, submit quotes, send approved quotes, record won/lost |
| Estimator | `estimator2@company-a.test` | Same, a second person (the approval rule stops anyone approving their own quote) |
| Sales head | `saleshead@company-a.test` | Everything above, plus approve or send back quotes and change rates |

## A five-minute tour

1. Sign in as `estimator@company-a.test`. **RFQs** shows 8 RFQs across the lifecycle (estimating, awaiting approval, sent, won, lost with a reason).
2. **New RFQ**, then **Use a sample email**, then **Read RFQ**. Each value shows where it came from, and values that were read or assumed are highlighted until you accept them. Tick "I checked this part", **Create RFQ**.
3. Open a part. The routing was suggested from the most similar past part, with its source. Accept it, then **Save costing**. The price table updates live as you edit and shows its formulas.
4. On the RFQ page, **Submit for approval**. The spindle is about ₹2.3 crore a year, above the ₹25 lakh limit. Cost the small spacer bush (RFQ-2611-027) and submit it: it is under the limit, so it approves itself.
5. Sign out, sign in as `saleshead@company-a.test`. **Approvals**, **Review**, **Approve**, then **Open PDF** for the quote with its cost breakup.
6. **Rate masters**: add a new EN8 rate starting tomorrow. Existing quotes keep their rates; the page shows it as "coming".
7. **Past quotes**: search by name, or give a material and weight to rank similar parts.

## Run it locally

Needs Node 20.9 or newer and a Postgres 14+ server.

```bash
git clone {{REPO_URL}}
cd quoteflow
npm install
cp .env.example .env
```

Edit `.env`: set `SESSION_SECRET` to a random string of 32 or more characters (`openssl rand -hex 32`).
The default `DATABASE_URL` matches the database below.

Start Postgres, either way:

```bash
docker compose up -d          # option A: Docker, port 54329
npm run db:local:start        # option B: a private cluster in .pgdata (needs the PostgreSQL server binaries)
```

Create the schema and demo data, then run:

```bash
npm run db:reset              # DROPS and recreates the public schema, then seeds
npm run dev                   # http://localhost:3000
npm test                      # 45 tests; the 15 service tests use a separate quoteflow_test database
```

## Environment variables (names only)

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `SESSION_SECRET` | yes | Signs session cookies, 32 or more random characters. The app refuses to start in production without it |
| `ANTHROPIC_API_KEY` | no | Turns on the AI reader for free-text emails the rule-based reader cannot read. Off by default |

## How it is deployed

Vercel (the Next.js app) and Neon (Postgres).

1. Create a Neon project and copy its connection string.
2. Create the schema and demo data once, from your machine. This **drops** the target's public schema, so only run it against an empty demo database:
   `DATABASE_URL="<neon string>" npm run db:reset`
3. In Vercel, import the GitHub repo and set `DATABASE_URL` and `SESSION_SECRET` (and optionally `ANTHROPIC_API_KEY`).
4. Deploy. The quote PDF route includes pdfkit's font files through `outputFileTracingIncludes` in `next.config.ts`.

No secrets are in the repository: `.env` is ignored and `.env.example` holds names only.

## Honest limits

- Sending a quote is mocked: it records the intent in the activity log and sends no email.
- Drawings are not stored or sent anywhere. The title block is read from pasted text only, and PDF/OCR of drawings is not built.
- The AI reader was written and unit-tested against a mocked API, but it has not been run against the live API in this build, because no key was available. The rule-based reader is the default and the tested path.
- Rate and cost numbers in the demo data are labelled assumptions, listed in the Technical Design Document.
