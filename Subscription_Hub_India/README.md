# Subscription Hub — India Edition

Design and Development of a Subscription Billing and Auto-Debit Management System

This is an updated version of the supplied project. It keeps the React dashboard,
Express API, account separation, MongoDB support, usage analytics and reminders.
It replaces Plaid discovery and simulated Stripe virtual-card controls with Indian
transaction discovery, a Setu AA adapter and Razorpay Subscriptions integration.

## Start here

Install Node.js 22 LTS (or newer compatible LTS). Extract this ZIP and open the
`Subscription_Hub_India` folder in VS Code. In its terminal:

```sh
npm install
npm run dev
```

Open http://localhost:5173. API: http://localhost:4000/api/health.
Register, then sign in. Open **Subscriptions**. Click **Try local sample data**,
review the matches and **Confirm selected subscriptions**. These are explicitly
local sample transactions; no bank or payment provider is contacted.

No `.env` is included. Copy `.env.example` to `.env` for a new installation, or keep your existing local `.env` when upgrading. Fill in your own credentials. See `ACCOUNT_SETUP.md` for the account email flows.
`npm test` runs automated tests; `npm run build` builds the web frontend.

## What is implemented

- Setu AA consent creation, provider approval handoff, status checks, data-session
  creation, JSON transaction extraction, pending/partial/error handling and revocation.
- CSV transaction import, monthly/quarterly/annual recurrence detection, debit-only
  and INR filtering, deduplication, confidence and stale-date flags.
- Candidate preview and explicit confirmation before creating subscriptions;
  previews expire after 30 minutes. CSV and raw AA responses are not saved.
- Razorpay allowlisted merchant plans, subscription creation, hosted Checkout,
  server-side signature verification, status sync, invoice/payment history and cancellation.
- Signed raw-body Razorpay webhooks, event deduplication, provider-state reconciliation.
- Per-user ownership checks, INR display, India calendar boundaries, IST reminders,
  SendGrid delivery when configured and once-per-day reminder records.
- Manual subscriptions, external provider cancellation handoff and usage analytics.
- Live modes explicitly gated; no pretend card issuance or fake bank connection.

## Local data versus persistent data

Without MONGO_URI, data is held in memory and lost on restart. This includes accounts,
consents and Razorpay ownership mappings. Configure MongoDB **before** serious provider
testing. Either MongoDB Community Server or Atlas is usable:

```dotenv
MONGO_URI=mongodb://127.0.0.1:27017/subscription_hub_india
```

Production refuses to start without MongoDB or SESSION_SECRET. Generate a secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the output after SESSION_SECRET= in `.env`. Never commit your real `.env`.

## Configure Razorpay Test Mode

1. Use your Razorpay merchant account and select **Test Mode**.
2. Generate test API keys. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in `.env`.
3. Create an INR monthly or yearly plan in that same account/mode. Set its ID in
   RAZORPAY_PLAN_IDS. Multiple IDs are comma-separated. Only these plans are offered.
4. Set MERCHANT_NAME to the merchant whose services these plans represent.
5. Restart the API. In Subscriptions, choose a merchant plan and click Subscribe
   and authorize. Complete the provider's test Checkout flow.
6. Enable UPI AutoPay / eMandate / card methods as available for your account.
   The app uses Razorpay Standard Checkout; it does not manufacture a UPI mandate.
   Available test/live methods and supported banks depend on Razorpay enablement.
7. Click Sync status. A created/authenticated subscription is not shown as active
   until Razorpay says it is active. Open Payment history to fetch its invoices.
8. To test cancellation, use Cancel subscription and confirm. No refund is created.

### Webhook setup

Expose the API through a trusted HTTPS tunnel or deploy it. Configure in Razorpay:

`https://YOUR_API_HOST/api/webhooks/razorpay`

Set the same webhook signing secret as RAZORPAY_WEBHOOK_SECRET. Subscribe to relevant
`subscription.*` events (activated, charged, pending, halted, cancelled, completed,
authenticated, paused/resumed where available). The handler verifies the raw body
signature, looks up the stored owner, fetches current provider status and records
processed event metadata. Failed processing returns an error so delivery can retry.
Manual Sync remains available if a webhook is missed. Payment history is fetched
from invoices on demand and stored without raw payment payloads.

Do not reuse test IDs with live keys. Live collections additionally require approved
merchant onboarding, enabled methods, live plan IDs and ENABLE_LIVE_PAYMENTS=true.
The UI explicitly labels live mode. No live payment was executed to validate this ZIP.

### Merchant scope

This implementation serves one configured merchant account plus personal external
subscription tracking. It is not a multi-merchant payment marketplace. Independent
merchants need their own approved account/onboarding and provider-supported routing.
It cannot cancel or collect payments for an unrelated Netflix/Spotify account merely
because a matching bank debit was discovered.

## Configure Setu AA Sandbox

1. Register at https://bridge.setu.co and create an Account Aggregator / FIU product.
2. Configure the consent purpose for personal finance/recurring-spend analysis,
   appropriate DEPOSIT transaction access, retention and customer redirect URL.
   Do not use an unrelated loan-underwriting purpose from a generic example.
3. Copy the **complete v2 FIU API base URL** provided by your product to SETU_BASE_URL.
   The default is https://fiu-sandbox.setu.co/v2; confirm it in your Bridge console.
4. Set SETU_PRODUCT_INSTANCE_ID, SETU_CLIENT_ID and SETU_CLIENT_SECRET. The adapter
   sends x-product-instance-id, x-client-id and x-client-secret. If your product uses
   Bearer authentication, supply SETU_ACCESS_TOKEN instead; rotate expired tokens
   through your approved provider credential process. Tokens are server-side only.
5. Keep SETU_MODE=sandbox and ENABLE_LIVE_AA=false. Restart the API.
6. Enter your test mobile/AA handle and tick the request checkbox. Create consent,
   click Open consent, and approve using the provider's sandbox screens.
7. Return and click Sync and scan. While the data session is pending, retry shortly.
   Review the candidates and confirm. If the bank fixture has no recurring charges,
   zero results is legitimate; the app never substitutes fake success data.
8. Revoke data consent when finished. Revocation does not cancel a payment mandate.

The requested data window is the 180 days preceding consent creation. Repeat scans
reuse that session snapshot; create a new consent for a later window. The adapter
polls status when the user clicks Sync, rather than trusting browser return parameters
or accepting unsigned AA callbacks. It supports Setu's documented v2 JSON shape.
Provider credentials/product versions must be tested in your own sandbox.

Live AA access requires an eligible approved FIU arrangement; it cannot be enabled by
code alone. Set the approved live URL, credentials, SETU_MODE=live and ENABLE_LIVE_AA=true
only after onboarding. Provider-side retention and consent restrictions still apply.

## Real bank CSV discovery

Use samples/indian-bank-transactions.csv or download the template from the app.
Accepted columns: date/transactiondate/valuedate; merchant/description/narration/
particulars; amount/debit/withdrawal/withdrawalamt; optional type and currency.
Dates: YYYY-MM-DD or DD/MM/YYYY. Amounts must be positive debits, with INR currency.
Credits are ignored if type is CREDIT/CR. Without a type column, all amounts are
interpreted as debits: use a debit-only export. Maximum 1 MB and 5000 rows per scan.
PDF/OCR and every bank's custom export format are not implemented; normalize to this
CSV template. Missing/invalid rows are counted. No bank password is requested.

Two or more spaced charges with similar values produce a candidate. Repeated rent
or loan payments may also match. Unknown merchants may be split by narration format.
The user must review results. Detection is a heuristic, not proof of an active mandate.
Annual detection needs at least two annual charges; the default 180-day AA window
cannot establish an annual pattern, but a longer CSV history can.

## Email, AI and usage

Set SENDGRID_API_KEY and a verified ALERT_FROM_EMAIL for delivery. Otherwise emails
are previewed in the API terminal. ENABLE_CRON=true enables the default 09:00 IST
renewal scan. Gemini remains optional; without its key/model access the existing
rule-based analytics work. Only subscription/usage summaries go to the insights
service; discovery does not send raw statements to an LLM.

Usage remains user-entered. This ZIP does not claim to implement cross-app Android,
TV or browser activity tracking, a Chrome extension or Spotify OAuth usage collection.

## Deployment and operational limits

- Deploy frontend and backend under the same site with HTTPS. Session cookies use
  HttpOnly/SameSite=Strict and Secure in production. Unrelated cross-site domains
  are not supported by this cookie configuration. Set WEB_ORIGIN exactly.
- Frontend VITE_API_URL is a build-time variable: set it before npm run build, e.g.
  https://api.yourdomain.com/api. Restart after backend configuration changes.
- Start API: npm --workspace apps/api start. Serve apps/web/dist using static hosting
  with an SPA fallback. API webhook route must receive the original raw body.
- Run a single API/cron instance for this project. In-process operation locks and
  daily mail deduplication are not a distributed transaction/queue system.
- A provider create timeout can leave an unresolved checkout intent. The API does
  not blindly repeat it. Check Razorpay Dashboard using the hub_request_id note
  before retrying. A full production recovery/reconciliation worker is future work.
- Production launch also needs account recovery/verification, monitoring, backups,
  privacy/retention review, and provider acceptance tests. MongoDB persistence and
  real provider calls were not exercised in the build environment.

## Validation supplied

Automated tests cover detection, CSV parsing, ownership, Setu lifecycle using mocked
provider responses, payment signatures, webhook replay, cancellation, live-mode gates,
passwords and analytics. See VALIDATION.md for actual results. Provider credentials
are intentionally absent, so sandbox/live provider end-to-end success is not claimed.

## Provider references

- https://docs.setu.co/data/account-aggregator/quickstart
- https://docs.setu.co/data/account-aggregator/api-integration/consent-flow
- https://docs.setu.co/data/account-aggregator/api-integration/data-apis
- https://docs.setu.co/data/account-aggregator/licenses-and-go-live/go-live
- https://razorpay.com/docs/payments/subscriptions/integration-guide/
- https://razorpay.com/docs/api/payments/subscriptions/create-subscription/

## Razorpay timeout recovery

See `RAZORPAY_RECOVERY_SETUP.md` for upgrade steps, pending-request recovery, tests, and the single-API-process limitation.
