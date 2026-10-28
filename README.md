# Job Channel Bot

Next.js app for scheduled ImageKit → OpenAI GPT-4o mini → Telegram job posts. Tavily searches for recruiter and company LinkedIn profiles; matches are unverified. This project is a new implementation and does not include the previous codebase.

## Safety and delivery semantics
- Each slot is independent. The oldest image is processed for each pipeline.
- Redis is mandatory and fails closed: no in-memory fallback. Slot claims are atomic, but Telegram does **not** offer end-to-end exactly-once delivery.
- Private and public delivery state is saved separately before and after each Telegram request. A failed explicit Telegram response remains retryable. An ambiguous timeout, crash, or failure saving a success requires manual review in the dashboard; check Telegram, mark the channel delivered or not delivered, then run again. **Never guess.**
- ImageKit deletion occurs only after all configured channels are recorded delivered. If deletion fails, the stored job is resumed and deletion retried without reposting. If deletion succeeded but storing cleanup failed, a 404 on retry counts as deleted.
- Non-job/uncertain screenshots are retained; no automatic deletion. Extraction and public masking are AI-assisted, not a guaranteed privacy filter. Dry-run and inspect output before going live. Search matches can be wrong; the bot only accepts recruiter and company name tokens in the result title, but even then verification is needed.
- One pipeline owns one unique ImageKit folder. Do not run other consumers on that folder. Changing channels while a job is pending is unsafe; finish/reconcile pending jobs first.
- Every cron slot is claimed before execution. An execution failure, lock contention or empty queue consumes that slot; the next configured slot retries the pending job. No catch-up for missed slots. Automated long-running pipelines may hit the Vercel function timeout; a stale `sending` state must be reconciled.

## Setup
1. Create an ImageKit account, Telegram bot, OpenAI API key, Tavily API key and Upstash Redis database. The bot must have permission to post to **both** channels. Upload test screenshots to `/Frontend`.
2. Copy `.env.example` to `.env.local` and fill in all credentials. Generate separate strong, random `ADMIN_TOKEN` and `CRON_SECRET` (e.g. `openssl rand -hex 32`). Never commit `.env.local` or share secrets in chat. Set `PIPELINES_JSON` to valid JSON: in Vercel paste **only the JSON array**, without the outer single quotes used in `.env.local`.
3. `npm install`, `npm run dev`, visit http://localhost:3000. Enter the admin token and use **Preview safely**. The dry run uses OpenAI and Tavily (and may incur cost) but does not post or delete. Test live with dedicated test channels first.
4. Deploy to Vercel: push this folder to a private Git repository, import it into Vercel, add all environment variables for the correct environment, and deploy. Never upload `.env.local` to Git. Production and preview deployments should use separate folders/channels/Redis, and preview deployments should not use production cron secrets.
5. Vercel's included daily cron triggers at 03:30 UTC = 09:00 IST. A separate scheduler such as cron-job.org must call `GET https://YOUR-DOMAIN/api/cron` every minute with header `Authorization: Bearer YOUR_CRON_SECRET`. Configure the secret as a request header, not a URL query parameter. The scheduler evaluates every pipeline's IST slots. Both the scheduler and Vercel cron can run together: Redis claims avoid duplicate slot claims while Redis is available. Vercel sends `CRON_SECRET` automatically for its cron.
6. Watch the protected dashboard and Vercel logs. After each deployment use a dry run and verify scheduler/authentication, folder spelling and both channel destinations. Set scheduler timeouts to accommodate the function's execution time; prevent automated immediate retries.

The `maxDuration=120` functions require a Vercel runtime/plan supporting that duration. Check your plan's limits and free-tier quotas before deployment: free services and model usage are not guaranteed to stay free, and OpenAI API usage is paid separately. If the scheduler or plan times out, the next slot may recover the work, but ambiguous Telegram delivery requires manual review.

## Adding pipelines
Edit `PIPELINES_JSON` as a JSON array of objects. Required properties: `name` (unique lowercase letters, numbers, `_` or `-`), `folder` (unique absolute ImageKit folder), `privateChannel`, `publicChannel`, `slots` (unique `HH:MM` times in IST), `ctaText`, and `ctaUrl`. Strings may be empty for an unused channel or CTA, but at least one channel must be set. Redeploy after changes. Use isolated Redis per deployment to avoid state collisions.

## Limitations
No cross-midnight slot window or automatic catch-up. Image downloads capped at 8 MB after download. Telegram posts over 3900 characters are held for review. Public masking depends on exact labels, and cannot guarantee contact information is absent elsewhere in model output. No rate limiting on authentication: use strong secrets and optionally Vercel protection. AI output and searched profiles must be verified for accuracy and privacy. The included Vercel cron alone runs only once per day; the external scheduler is necessary for the other slots.

## Tavily key rotation

Set `TAVILY_API_KEY`, and optionally `TAVILY_API_KEY_2` and `TAVILY_API_KEY_3` in Vercel, then redeploy. When a search receives HTTP 429 or 432, it tries the next configured key in the order 1 → 2 → 3 → 1. Redis remembers the current key across requests. Each search tries each configured key at most once; if all are exhausted, posting continues without Tavily results. A 429 may mean a temporary rate limit rather than exhausted credits; no system can restore a quota automatically. Avoid changing key order while requests are running. Use keys only within Tavily's terms and quotas.

## Scheduled posting toggle

Each pipeline has an admin-only schedule switch on the dashboard. It defaults to On and is stored in Redis; switching it Off prevents new scheduled slot claims for that pipeline. Manual dry and live runs remain available. Turning it off does not cancel a run already started. If switched back on during an active slot window, that slot may still run; missed past slots are not caught up. Keep Redis data and credentials stable across deployments to preserve the setting.
