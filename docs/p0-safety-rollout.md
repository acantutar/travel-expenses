# TripSplit — P0 safety gate and backup rollout (2026-11-05)

## Current state verified against live Supabase (read-only)

- All ten application tables in the public schema have RLS enabled.
- Ledger, settlement, trip, member and trip-rate read policies filter by active trip membership.
- Currency catalog is intentionally public-readable.
- trip_invitations has RLS enabled and no direct data-access policies; invitations are accessed through dedicated RPCs.
- Security Advisor flags SECURITY DEFINER functions. This is a review finding, **not** proof of a vulnerability. For example, preview_trip_invite is deliberately callable without login and requires a 64-character secret token whose SHA-256 hash matches an unused, unexpired invitation. Do not globally revoke RPC access without testing the invite flow.
- Current browser smoke tests use a mock database. They do not prove cross-account security in production.

## Release requirements before anonymous onboarding

1. Create TWO disposable test identities and TWO trips in a non-production environment.
2. Verify A cannot SELECT B's trip, ledger, settlements, members or FX rates.
3. Verify A cannot call create/revise/void/settle/member-edit RPCs for B's trip, including guessing B's UUID.
4. Verify a removed participant loses access without deleting prior ledger versions.
5. Verify a consumed, expired, or revoked invitation cannot be redeemed again.
6. Verify concurrent invite redemption cannot exceed allowed uses.
7. Verify direct table writes are unavailable where edits are designed to occur exclusively through RPCs.
8. Verify no service_role or database connection string reaches the browser.
9. Record observed results, including any unexpected information disclosure, before marking the P0 gate green.

## Anonymous guest migration blocker

Supabase Auth anonymous sessions use the authenticated DB role but carry an is_anonymous JWT claim. The current handle_new_user trigger creates a profile only for synthetic emails ending in travel-expenses.app, so anonymous users would **not** get the profile expected by is_active_user(), create_trip(), and trip membership policies.

Therefore simply calling signInAnonymously() in the frontend would **not** implement safe guest access. Before enabling guest signup, design and test the guest profile lifecycle, durable account linking, session-loss recovery warning, rate limiting, and role-separated permissions. Do not expose a public writable trip ledger to bypass this.

Reference: https://supabase.com/docs/guides/auth/auth-anonymous

## External encrypted backups: currently NOT active

An in-browser JSON export or localStorage mirror is not an off-server automated backup. The project still needs a backup system outside the Supabase server.

Minimum requirements:
- Daily consistent database export including all trip, member, ledger version, settlement version and FX tables, plus schema/migrations needed for recovery.
- Encrypt **before** uploading, using a dedicated backup encryption public key.
- Store ciphertext in storage outside Supabase; a repository commit or unencrypted Actions artifact is not suitable.
- Access keys / database credentials ONLY in an approved secret store. No secrets in GitHub source, browser, logs, or PRs.
- Retention policy (proposal: 7 daily + 4 weekly) and alert on missing backups.
- Restore a recent encrypted backup into an isolated test database, verify table counts, one trip ledger and referential integrity. Never overwrite production in a routine restore test.
- Document the emergency restore procedure and ensure the decryption private key is retained safely outside the server.

Implementation remains blocked on an offsite destination and secret management. Do not label this feature 'done' until a scheduled run and a real restore rehearsal succeed.

## Change discipline

- Keep P0 database changes in versioned migrations and separate reviewable PRs.
- Existing ledger data must never be wiped, rewritten in place, or migrated without reconciliation.
- The new Node ledger regression tests run as part of CI and test functions extracted from the real app.js.
- Existing Chrome smoke tests must remain green.
- The release gate is not complete until the tests above run against a correctly provisioned isolated database.

## Product direction (non-negotiable)

'Geziyi yaşa. Hesabı düşünme.' No app installation or signup to **start** a trip in the target release; friends may be added by name first and securely link identities later. No expansion into personal financial management or banking.
