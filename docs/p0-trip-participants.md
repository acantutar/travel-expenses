# TripSplit — Trip participant identity model (P0)

## What this phase changes

Adds a separate **trip-local person's identity** (`trip_participants`). It does not equal a Supabase Auth user or a `trip_members` row.

- `id`: stable participant UUID **within a trip**
- `trip_id`: parent trip, enforced by foreign key
- `display_name`: 1–60 characters, case-insensitive uniqueness among *active* people within the trip
- `linked_user_id`: nullable and currently always NULL. It is **not** populated merely because a participant's name matches an account name.
- `is_active`: supports retaining history when a person leaves; no removal operation exists in this first phase
- `created_by` and `created_at`: audit metadata, taken on the server

The trip owner/admin can add a person through `add_named_trip_participant(trip_id, name)`. Active trip members can read people for their trip. Other users cannot. No client can directly INSERT, UPDATE or DELETE the participants, and the RPC never accepts a linked account identity.

This **does not** rewrite `profiles`, `trip_members`, `expense_versions` or `settlement_versions` and does not change any existing calculations.

## Not yet complete

**A named participant cannot yet be used as a payer or shared participant in the existing expense/settlement RPCs.** These RPCs and historic columns currently use `profiles.id`. A separate backward-compatible ledger adaptation is necessary before the user sees the full 'add friends by name and split expenses' workflow.

Recommended follow-up: new expense/settlement participant identity columns (with trip-scoped FKs, not global IDs), version-aware reads, settlement calculations, CSV and eventual XLSX exports, and safe migration of the front-end to participant IDs for new trips. Old ledger records must retain their original immutable versions; avoid in-place UPDATE.

An existing real account can only be linked to a trip participant after explicit authenticated invitation acceptance and ownership confirmation. No name-only claim should ever grant access. `linked_user_id` must not be directly writable by browser users.

## Tests

`tests/rls/50-trip-participants.sql` runs inside disposable PostgreSQL 17 CI with three synthetic account identities after existing RLS/guest test cases. It checks:

- Owner can add multiple names without creating authentication accounts
- Names are trimmed and duplicate active names rejected
- Other trips cannot read or add people
- A non-manager member can read, but cannot create
- Direct write grants are absent
- No implicit account linking
- Old expense and payment ledger rows remain unchanged

## Release guard

This PR only commits the additive migration and tests to GitHub. **It must not be applied to live Supabase just because CI is green.** The actual person-based ledger and app-flow modifications have not been implemented; no live schema changes are needed to preserve current behavior.

As previously decided, automated offsite backup work is deferred. Do not reintroduce it as part of this development.

## Product promise

'Geziyi yaşa. Hesabı düşünme.' Focus on doing less work, not adding personal finance features.
