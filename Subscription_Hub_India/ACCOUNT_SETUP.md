# Account email update

## Upgrade on Windows

1. Stop the app using Ctrl+C. Back up your current project.
2. Extract this ZIP into a NEW folder. It contains one Subscription_Hub_India folder with package.json at its root.
3. Copy your existing local .env into that root folder. Do not upload it or commit it.
4. Keep your existing MONGO_URI to retain users and subscriptions. Existing records get safe defaults for the new fields; no manual migration is needed.
5. Set WEB_ORIGIN=http://localhost:5173 (the frontend address). This is the address used in reset and verification emails, not the API tunnel URL.
6. Keep SENDGRID_API_KEY and ALERT_FROM_EMAIL configured with your verified sender. Replace credentials exposed in screenshots or uploads.
7. Run npm ci, then npm run dev. The frontend must be running when opening a local email link.
8. Keep CRON_SCHEDULE=0 9 * * * and CRON_TIMEZONE=Asia/Kolkata for daily renewal reminders.

## Test the new flows

- Register an account you control. Open the verification email and click Verify email on the website. The link expires after 24 hours and works once.
- Existing accounts can still sign in. Use Resend verification on the sign-in screen to verify an existing account. The sidebar shows verification status after signing in.
- Sign out, choose Forgot password?, enter the registered email, and open the emailed link. Set and confirm a new password. The link expires after 30 minutes.
- Sign in with the new password. The old password and existing sessions should no longer work.
- Reusing a reset or verification link should show an expired/already-used message.
- Resending creates a new link and invalidates the previous link. Use the most recent email.
- Unknown addresses receive the same reset-request response to avoid directly disclosing registered users.

## Behavior and limits

Email verification is recorded and visible but does not block sign-in or payment actions. This preserves access for existing users. Account emails require actual configured delivery; they never print action links in preview logs. Registration still succeeds if its email fails and offers resending. Reset and resend responses stay generic; inspect backend logs and SendGrid activity to diagnose delivery failure.

Tokens are random and only SHA-256 digests are stored. MongoDB consumes each token atomically with its account update. Password reset increments a session version, invalidating prior session cookies. In-memory storage is for development only and is lost on restart. Auth POST routes are limited to 30 requests per IP per 15 minutes. Account links use URL fragments; third-party analytics should not be added to these screens without checking token handling.

## Validation performed

- npm test: 26 tests passed, including registration email, verification, replay rejection, concurrent reset attempts, password validation, old-session rejection, unknown-account response, expired tokens, and replacement-link invalidation.
- npm run build: passed.
- Email provider requests in automated tests are mocked; no real emails or payments were sent during this update.
- MongoDB integration and real browser acceptance need local verification. Chromium was unavailable in the editing environment.

## Remaining work

Razorpay timeout reconciliation, complete browser end-to-end testing, deployment and production hardening remain separate tasks. This update does not claim those are complete.
