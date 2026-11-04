# India implementation scope

## Replacements
- Plaid and react-plaid-link removed from source and dependencies.
- Fake Stripe card creation/lock routes and UI removed.
- Setu AA adapter + CSV discovery with user-confirmed candidates added.
- Razorpay merchant subscription creation, authorization, sync, cancellation,
  invoice history and signed webhook processing added.
- Existing React/Express/MongoDB/AI/SendGrid stack retained because these can serve India.

## Core records
Subscription: owner, merchant, monthly INR equivalent, renewal estimate, status,
provider, provider ID/status and discovery key. UsageLog: owner/subscription/hours.
IntegrationRecord: consent metadata, expiring discovery preview, merchant subscription
owner mapping, checkout intent, invoice summary, processed event and reminder marker.

## API groups
/api/auth — accounts and session cookies
/api/india/status — public integration readiness for signed-in users
/api/india/discovery/preview — local sample or CSV scan
/api/india/discovery/confirm — selected candidate import
/api/india/aa/consents — consent list/create/sync/revoke
/api/razorpay/plans — configured merchant plans
/api/razorpay/subscriptions — create/list/sync/cancel/payment history
/api/razorpay/verify — checkout signature verification
/api/webhooks/razorpay — signed subscription notifications
/api/subscriptions — manual and externally tracked subscriptions
/api/analytics, /api/usage, /api/notifications — retained dashboard services

No universal external-service cancellation, bank credential collection, virtual
card issuance, multi-merchant settlements or automatic mobile usage tracking is claimed.
