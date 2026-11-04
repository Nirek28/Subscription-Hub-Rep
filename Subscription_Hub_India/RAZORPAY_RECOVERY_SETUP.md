# Razorpay timeout recovery update

## Install on Windows

1. Stop the old project with Ctrl+C in its npm run dev terminal. Keep the Cloudflare terminal open.
2. Extract this ZIP into a new folder. Open the Subscription_Hub_India folder containing package.json.
3. Copy your existing local .env into that folder. Keep the same MONGO_URI so accounts and subscriptions stay available. Use the same Razorpay account and mode as the original request.
4. Run npm ci, then npm run dev. Only one copy of the API may run. The expected frontend port is 5173 and API port 4000.
5. Open http://localhost:5173 and sign in. Go to Subscriptions and the Razorpay panel.

## What changed

- Pending creation requests are now listed with their plan and request IDs.
- Check pending request searches Razorpay without creating or charging another subscription.
- Matching requires the exact user ID and request ID in Razorpay notes, and the original plan ID.
- A recovered subscription is linked back to the dashboard, preserving existing local records. Its current status is fetched from Razorpay.
- Resume authorization remains available when the provider status is created. A recovered record does not mean a payment succeeded.
- Repeating a creation request with the same request ID returns or recovers the original subscription.
- A different request ID for the same user and plan is blocked while an earlier request is pending.
- The frontend retains request IDs in sessionStorage until checkout opens, including through page reloads. Request storage is scoped by account and plan.
- Signed subscription webhooks can trigger recovery for pending requests when their payload contains the matching notes.
- Earlier pending records without timestamps or stored plan details can also be recovered.

## Safe failure behavior and deployment limits

A provider timeout does not prove the subscription was not created. No match, multiple matches, invalid provider data, or search limits leave the request pending. The app never automatically resends the external creation POST. Check again later or review the original request in the Razorpay Dashboard; do not delete the pending record just to force another attempt. Definitively rejected requests also stay pending for operator review in this conservative version.

Recovery reads at most 1,000 provider subscriptions for the original plan. It requires a complete search within that limit before adopting a match. Large merchant accounts require an expanded indexed reconciliation workflow. Use the original Razorpay account/mode. Changing accounts can make matching subscriptions invisible.

Run ONE API process/replica. Locks are in-process, not distributed across servers. Multi-replica deployment requires database-backed request claims before enabling it. MongoDB is required for durable pending records across restarts; memory mode is development-only.

## Checks performed

- npm test: 37 tests passed.
- npm run build: passed.
- Coverage includes response loss after provider creation, duplicate/repeated/concurrent attempts, pending ownership, pagination, empty and malformed responses, provider outages, legacy requests, partial local saves, ambiguous matches, mode mismatch and signed webhook recovery.
- Providers are mocked in automated tests. No real payments or emails were sent during development.
- Browser automation was not completed: the Chromium download failed. MongoDB-backed recovery and actual Razorpay test-mode behavior still require a local end-to-end check.

## Local acceptance test

1. Confirm ordinary creation and Resume authorization still work in Razorpay Test Mode.
2. If you have an existing pending request, click Check pending request. A matching subscription should appear once in the dashboard; repeat the check to confirm no duplicate.
3. If there is no match, the pending request must remain visible and a fresh creation for that plan must remain blocked.
4. Run npm test to exercise the simulated timeout cases without intentionally interrupting a payment or changing real credentials.

This update preserves the tested account emails, password reset, verification and reminder setup. Deployment and a full browser acceptance pass remain next steps.
