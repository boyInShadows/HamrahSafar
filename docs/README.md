# Setup, deployment and verification

This guide describes the repository's implemented behavior. It does not establish that a public deployment or real payment provider has been verified.

## Local setup

`package.json` declares Node >=20. `netlify.toml` selects Node 22 for frontend builds. Local verification on 29 October 2026 used Node 24.11.1 and npm 11.6.2; Node 20 was not separately reproduced. Install the existing locked dependencies with `npm ci`.

Use a new local data directory for review. The server automatically creates its schema, default roles and illustrative tours on a fresh database; there is no separate migration or seed command to run. Existing databases can be upgraded at startup, so preserve their backups and never point a review session at customer data.

Configure these variables in the launching environment. On the maintainer's Windows workstation, keep real credentials in Windows user environment variables and restart the terminal after changing them. [`.env.example`](../.env.example) lists configuration names; do not put real secrets in documentation or committed files.

| Variable | Local review setting or purpose |
|---|---|
| `DATA_DIR` | Absolute path to a new review directory; holds `hamrah.db` and `uploads/` |
| `PORT` | Local server port; defaults to 3000 |
| `ADMIN_USER`, `ADMIN_PASS` | Initial local admin credentials; only initialize an empty database |
| `COOKIE_SECURE` | `false` for plain local HTTP; `true` behind production HTTPS |
| `NODE_ENV` | Use a non-production environment for the internal payment simulator |
| `SMS_PROVIDER` | `log`; records messages without sending real SMS |
| `PAYMENT_GATEWAY` | `sandbox`; the application's internal simulator |
| `SITE_URL` | Exact browser origin if configured; no path, query, credentials or fragment |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | Leave unset for local SQLite; only set intentionally for a separate remote libSQL/Turso service |

The default data path is `data/` at the checkout root. An explicitly configured `DATA_DIR` takes precedence. First-run credentials do not reset an existing admin account. If `ADMIN_PASS` is absent, the app prints a generated initial password once; supply your own through the environment for a controlled review and keep server output private.

```bash
npm start
```

Open `http://localhost:3000`, `/admin.html` and `/office.html` through the server. Do not open HTML files directly. A custom `PORT` changes those addresses. Login through the office form with your synthetic local admin. The existing libSQL integration supports a local SQLite file or a remote database; uploads still require persistent filesystem storage.

## Synthetic walkthrough

1. Browse a seeded trip with available seats. Tour descriptions, prices and schedules are illustrative data, not a claim of current commercial availability.
2. Make a reservation using a synthetic name and phone. Check the server-derived total and reference, then track it with the same phone.
3. With internal sandbox payment selected, simulate failure, start another attempt and simulate success. Confirm the balance and booking status in tracking.
4. Sign in at `/office.html` and inspect bookings/payments, customer records and role-dependent tabs. Keep credentials, cookies and customer records out of captures.

The recorded walkthrough used local booking/payment API calls, tracking and an actual office-form login/display. It was representative verification, not a complete browser regression suite. See [browser outcomes](artifacts/github-browser-results.json) and the two screenshots linked from the root README.

The original documentation identifies the Qom tour and two day-trip images as crops of three supplied project photos. Those assets remain unchanged; this pass makes no new reuse-license claim. Vazirmatn is loaded from Google Fonts, so an offline preview may use a fallback unless fonts are hosted locally.

## Payment and SMS behavior

The earlier statement that online payment was not implemented is superseded by the current [finance module](../server/office/finance.js) and [public payment routes](../server/office/index.js). Two paths exist:

- `PAYMENT_GATEWAY=sandbox` is an internal simulator. It is available outside production; production disables it unless `ALLOW_SANDBOX_PAY=true` is explicitly chosen for a controlled private test environment. A simulated success is not a real financial transaction.
- `PAYMENT_GATEWAY=zarinpal` selects request/callback/server-verification code and requires `ZARINPAL_MERCHANT`. It calls Zarinpal's real API addresses. This implementation was inspected, but merchant onboarding, real credentials, settlement and live transactions were not verified or executed in this pass.

Payments cannot be started for an already-paid/non-positive payment or a cancelled reservation. Public online methods depend on gateway readiness. These are implementation checks, not a complete payment audit.

`SMS_PROVIDER=log` writes message records locally. Kavenegar delivery requires `SMS_PROVIDER=kavenegar`, `SMS_API_KEY` and, where required, `SMS_SENDER`; real SMS delivery was not tested. Keep the backend running for scheduled reminders. The older `/admin.html` cancellation route does not calculate penalties; the office cancellation workflow handles penalty/refund accounting.

## Netlify frontend and separate backend

The frontend build copies `public/` to `dist/`; it does not package the Express server. A local build without `BACKEND_URL` is explicitly a static preview. On Netlify, a missing or invalid `BACKEND_URL` fails the build.

1. Run the Express backend on a persistent Node host. Use `npm ci --omit=dev`, `npm start` and an absolute persistent `DATA_DIR`. Back up database/uploads before a backend release. Use one backend instance with the local database and in-memory rate limits.
2. Configure `NODE_ENV=production`, initial admin credentials, `COOKIE_SECURE=true` and `SITE_URL` equal to the frontend's HTTPS origin. Keep provider/database credentials only on the backend host. Local accounts are not transferred by Git.
3. Set `TRUST_PROXY=true` only when the reverse proxy overwrites forwarded headers and blocks spoofing. Otherwise leave it false. Do not weaken Origin checks or disable TLS to make a deployment work.
4. In Netlify, use the existing `netlify.toml`: `npm run build`, publish `dist`, Node 22. Set `BACKEND_URL` to the backend's **HTTPS origin**, such as `https://backend.example.com`, without a path/query/credentials/fragment. The generated rules proxy `/api/*` and `/uploads/*`, preserving the browser origin and session-cookie behavior.
5. Verify login/logout, reservation, upload/persistence and return URLs through the actual frontend before claiming deployment success. Frontend rollback uses an earlier deploy; backend rollback must preserve persistent data.

See the official [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/) and [Netlify proxy documentation](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/). No VPS, DNS, certificate, hosting setting or customer data was changed by this work.

## Verification and review

Base application revision: `6a985930c5aa`. The request-parser dependency fix is commit `538b82b`. Commands ran in an isolated checkout on D:; fixture databases/uploads were created separately, then removed after their server stopped. The original checkout and its data were preserved.

| Check | Result on 29 October 2026 |
|---|---|
| `npm ci --cache D:/.npm-cache` | Exit 0 on the original lock; two transitive packages subsequently updated |
| `npm run check` | Exit 0; 26 JavaScript files syntax checked; this is not type checking |
| `npm test` | Exit 0; 21 tests passed, none skipped |
| `npm run build` | Exit 0; frontend-only preview generated without a configured backend |
| `npm audit --json` | Exit 0; zero reported findings after the scoped lock update |
| Chromium representative checks | Storefront HTTP 200/RTL at 1440px; 360px without horizontal overflow; server-derived booking total; sandbox failure/retry/success; tracked balance zero; synthetic record visible after office-form login; no page errors |

[Command results](artifacts/github-command-results.json) and [browser results](artifacts/github-browser-results.json) retain exact outcomes. Screenshots were visually inspected. There is no separate lint or TypeScript command in the manifest.

README and this guide were rendered with GitHub's Markdown API and inspected in Chromium, without broken images or horizontal overflow. Relative document/image links were checked locally before publication.

Bounded review covered booking validation/transaction boundaries, gateway readiness/request/verification, SMS log behavior and the JSON middleware trust boundary. Graph queries/snippets and a caller/callee trace used codebase-memory project `hamrah`, generation `2026-10-19T12:56:50Z`; coverage flags for changed or excluded source/tests were followed by direct reads. This is not an exhaustive repository security audit.

The compressed-body regression reproduced a process crash on `body-parser` 2.3.0, then passed on 2.4.0. The lockfile also moved `qs` from 6.16.0 to 6.17.1; no direct dependency or application API was added. Sources: [body-parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828), [qs advisory](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw). Reachability of the qs serialization issue was not established; the installed vulnerable version was removed.

[Hosted Node 22 CI](https://github.com/boyInShadows/HamrahSafar/actions/runs/40939128422) passed on revision `a84af44`, running installation, syntax checks, all 21 tests, build and high-severity audit. That is separate from the local Node 24 results above. Real payment/SMS services, complete accessibility coverage, remote admin access, production persistence/reboot recovery, certificate renewal and customer launch status remain unverified. Existing asset credits and ownership remain unchanged.
