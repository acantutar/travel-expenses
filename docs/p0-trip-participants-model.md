# TripSplit P0 — Trip participants (independent of login accounts)

## Scope shipped in this PR

**Goal:** A trip owner can add "Ahmet", "Sena Yılmaz" etc. before those people join or even create accounts. Every logical person has an immutable UUID unique within its trip. This is the foundation for later split-calculations without login.

The additive PostgreSQL migration `migrations/v4_5_trip_participants.sql` creates:

- `public.trip_participants` — `id` UUID, `trip_id` UUID, `display_name`, `is_active`, `created_by`, `created_at`, nullable `linked_user_id`, `linked_at`, `linked_by`.
- RLS: active trip members can read only participants in their trips; active owner/admin users can add **unlinked** names. Direct editing/deleting and linking are not exposed.
- A low-privilege `SECURITY INVOKER` RPC `public.add_named_trip_participant(trip_id,display_name)`. Names 2–60 chars, normalized spaces. Active names must be unique (case-insensitively) **within** a trip; reuse in other trips allowed.
- Linked account fields deliberately cannot be supplied by the caller. Future identity linking will require a verified invite/explicit claim approval — **no match by display name**.
- Composite `(trip_id,id)` unique key for future multi-column FKs so a participant from trip B cannot be assigned to trip A's expense.

## Deliberate non-changes

The migration **does not update or delete** `public.profiles`, `public.trips`, `public.trip_members`, `public.expense_versions`, `public.settlement_versions`. It does not create fake users or sign-in credentials.

The app's current ledger still uses real `profiles.id` for payer and participant IDs, so **the new roster cannot yet be used in real spend splitting**. The frontend does not advertise this as finished, and guest start remains switched off.

## What still needs to be built

1. Map all existing and future authenticated members to optional, verified logical participants in each trip (without changing ledger history).
2. Introduce participant references for new expense/settlement versions with **server-side validation** of all payer/participant IDs belonging to the same trip. Preserve the historical version rows and current calculation results.
3. Use account-independent logical participant IDs to render totals, payers, debts, CSV, and future XLSX.
4. Safely link a named participant to a user after a valid invitation and positive approval/verification; matching display names alone is insufficient.
5. Add a one-line friend-add UI and real browser tests once new expense/settlement semantics are working.
6. Only then unlock anonymous guest onboarding, after the Auth provider and email account-recovery flow are verified.

## Security tests

`tests/rls/50-named-participants.sql` runs against the existing synthetic two-user + guest PostgreSQL 17 CI environment. It checks: the owner can add a name; other trips cannot see or edit it; the same name can occur in another trip; duplicate names are rejected within a trip; direct creation cannot forge a verified identity or creator; an anonymous guest can add names to their own trip; ledger counts are preserved. No real Supabase users/data are used by CI.

## Rollout

If integration tests pass, the additive migration may be applied to the production Supabase project after verifying schema compatibility. This changes **only newly created DB objects** and does not alter the current user interface or legacy ledger. Deployment should not be confused with completion of the end-to-end "add friends without registration and split their costs" feature.

User previously deferred automated off-server backups; no backup infrastructure is added by this PR.
