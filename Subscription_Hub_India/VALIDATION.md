# Validation — 4 November 2026

- npm install: passed.
- npm test: 23 tests passed, zero failed.
- npm run build: passed (Vite production bundle).
- Actual API process startup and /api/health: HTTP 200, ok=true.
- Actual API cross-origin mutation guard: HTTP 403 for an untrusted Origin.
- Provider tests: mocked Razorpay and Setu API responses; no credentials or real
  provider account were used. No claim of live or sandbox provider acceptance testing.
- Browser visual/click smoke test: attempted but blocked because this environment
  had no Chromium binary and the browser download failed. Not counted as passed.
- MongoDB persistence: implemented through Mongoose; real MongoDB was not available
  for integration testing here. Tests use the project's in-memory repository.

Coverage includes user ownership boundaries, consent approval/rejection gating,
revocation, recurring debit detection, CSV variants, confirmation/deduplication,
Razorpay plan allowlist, checkout request replay, invalid and valid signatures,
webhook duplicate processing, current-provider-state reconciliation, cancellation
confirmation, live-payment blocking and IST calendar boundaries.

Live onboarding, provider-enabled payment methods and successful sandbox user
journeys must be checked with your own approved accounts before public deployment.
