# Launch Score

Launch Score scans one public page and produces a deterministic score out of 100 with evidence for every deduction. The scanner powers the local CLI and Fastify API; `web/` contains the three copy-ready Next.js App Router pages.

> Automated checks catch only part of real issues. Launch Score is not a legal accessibility certification. Template signals are opinionated heuristics.

## Requirements

- Node.js 20 or newer
- pnpm 10
- Chromium for Playwright (`pnpm exec playwright install chromium` for local scans)
- Docker, for local Postgres

## Local setup

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres
set -a; source .env; set +a
pnpm --filter api migrate
pnpm build
```

Run the API with `pnpm --filter api dev`. The web app runs with `pnpm --filter web dev`. Run all unit tests with `pnpm test`.

`PSI_API_KEY` is required for the performance category. When it is absent or all PSI requests fail, the report is explicitly partial and scales the completed category scores to 100.

## CLI

```bash
pnpm --filter launchscore build
pnpm --filter launchscore exec launchscore https://example.com --out ./reports --runs 3
pnpm --filter launchscore exec launchscore https://example.com --repeat 3
pnpm --filter launchscore exec launchscore batch ./urls.txt --out ./reports --csv results.csv --concurrency 2
```

A single run writes self-contained JSON and HTML reports. Batch mode records failed URLs in the CSV instead of stopping. The calibration workflow is to scan approximately 50 representative sites, inspect false positives, and adjust weights only in `packages/scanner/src/config.ts`.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Pooled Neon connection used by the API |
| `DATABASE_URL_DIRECT` | Direct Neon connection used only by migrations |
| `PSI_API_KEY` | PageSpeed Insights API key |
| `RESEND_API_KEY`, `RESEND_FROM` | Report-email delivery |
| `IP_HASH_SALT` | Long random secret used before storing client identity |
| `ALLOWED_ORIGIN` | Exact web origin allowed by CORS |
| `REPORT_BASE_URL` | Public web URL used in reports, email and bot user agent |
| `NEXT_PUBLIC_LAUNCHSCORE_API` | Cloud Run URL used by the Next.js pages |
| `PORT` | API port; defaults to `8080` |

Never commit `.env` files. Logs contain scan IDs and error classes, not raw IP addresses or email addresses.

## Neon

1. Create a Neon project in the region closest to the Cloud Run region.
2. Copy the pooled connection string (hostname contains `-pooler`) to `DATABASE_URL`. Keep `sslmode=require`.
3. Copy the direct connection string to `DATABASE_URL_DIRECT`. Keep `sslmode=require`.
4. Apply migrations with `pnpm --filter api migrate`. The runner applies `apps/api/migrations/*.sql` once and records each file in `schema_migrations`.
5. Store both URLs in Google Secret Manager. Pass the pooled URL to the service at runtime; retain the direct URL for migration jobs only.

The runtime pool is intentionally limited to three connections because each Cloud Run instance handles one scan at a time.

## Cloud Run

The container uses the Playwright base image matching the scanner dependency, builds the scanner and API, listens on `$PORT`, and launches `apps/api/dist/server.js`.

Create secrets for `DATABASE_URL`, `PSI_API_KEY`, `RESEND_API_KEY`, and `IP_HASH_SALT`, then deploy from the repository root:

```bash
gcloud run deploy launch-score-api --source . \
  --region northamerica-northeast2 \
  --memory 2Gi --cpu 2 --concurrency 1 \
  --min-instances 0 --max-instances 3 \
  --timeout 120 --allow-unauthenticated \
  --set-env-vars ALLOWED_ORIGIN=https://example.com,REPORT_BASE_URL=https://example.com,RESEND_FROM=reports@example.com \
  --set-secrets DATABASE_URL=launchscore-database-url:latest,PSI_API_KEY=launchscore-psi-key:latest,RESEND_API_KEY=launchscore-resend-key:latest,IP_HASH_SALT=launchscore-ip-salt:latest
```

After deployment, set `NEXT_PUBLIC_LAUNCHSCORE_API` to the returned Cloud Run URL.

For Cloudflare Workers Builds, keep the repository root as the working directory and use these commands:

```text
Build command:  pnpm cf:build
Deploy command: pnpm cf:deploy
```

These commands explicitly target `web/`, whose `wrangler.jsonc` deploys only the `launchscore-web` Worker. Do not use `npx wrangler deploy` from the monorepo root.

In Google Cloud Billing, create a monthly budget for the project and enable email alerts at multiple thresholds (for example 50%, 80%, and 100%). Budgets alert you; they do not automatically cap spend. Keep Cloud Run at `max-instances=3` as an additional cost and abuse bound.

## Web integration

Copy `web/app/score`, `web/app/score.css`, and `web/lib/types.ts` into the existing App Router site. Import `score.css` from its root layout or merge the tokens and selectors into the existing terminal design system. The included standalone `web/app/layout.tsx` is for local verification and can be omitted when integrating.

Routes:

- `/score` submits a scan and shows staged progress and API-specific errors.
- `/score/[id]` server-renders the report, findings, limitations, lead capture and audit CTA.
- `/score/method` publishes weights, deductions, caps, bands and the version changelog.

## Security model

Only HTTP(S) default ports are accepted. Before any request, all A and AAAA records are resolved and checked. Literal IPs, local hostnames, private/reserved ranges, unsafe redirect targets, and unsafe browser subrequests are blocked. DNS results are cached only for one scan. `skipSsrfGuard` works only when `NODE_ENV=test`.

The scanner follows at most five redirects and has a hard 90-second cap. Cloud Run uses a 120-second request timeout to leave time for serialization and persistence. Scan and email limits use atomic PostgreSQL counter rows keyed by the salted IP hash, so concurrent requests cannot bypass the limit and cached scans are counted too.
