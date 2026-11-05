# TripSplit P0 — encrypted offsite backups

## Status

**Code staged; production backup NOT ACTIVE.** No production database credentials or private encryption keys are stored in this repository. Merge and a one-time owner setup are required before daily backups can run. PR smoke tests use only fabricated data.

## What the workflow backs up

Every day at 02:17 UTC, when explicitly enabled:

1. PostgreSQL 17 pg_dump takes one consistent snapshot of the public, app_private, auth, storage and supabase_migrations schemas, including user records and financial ledger versions.
2. The script checks that the dump can be read and that core TripSplit tables are present.
3. The custom dump, hash and manifest are encrypted using age X25519 with a **public recipient** key.
4. Only the encrypted .tar.age file is uploaded as a GitHub Actions artifact outside Supabase.
5. Each artifact expires after 35 days (subject to repository artifact retention policy and GitHub Actions storage limits). Failure to back up aborts the job and does not upload partial results.

**Important:** This public GitHub repository makes encrypted artifacts potentially accessible. Keep the private key safe and offline. Never commit, share or upload the private identity to GitHub or chat.

## What is not covered

- Storage object FILE BYTES (only object metadata): at last check TripSplit had 0 Storage objects, but this can change.
- Edge Function code/secrets, email/SMTP, OAuth configuration, third-party integrations and DNS.
- Multi-year archiving or point-in-time recovery.
- A proven restoration of real production data into a complete Supabase project. The automated CI proof restores **synthetic** records into temporary PostgreSQL 17.

This is a low-cost initial offsite snapshot strategy rather than a permanent disaster recovery service.

## One-time owner activation

1. Install the official age utility on your own trusted device (https://github.com/FiloSottile/age/releases). Generate the encryption identity and keep TWO secure offline copies of the private file. Example commands:

       age-keygen -o tripsplit-identity.txt
       age-keygen -y tripsplit-identity.txt

   The second command prints an age1... PUBLIC recipient. **Never send anyone the private identity file.** Without it the backup cannot be decrypted.

2. GitHub repository -> Settings -> Secrets and variables -> Actions:
   - Repository SECRET named TRIPSPLIT_BACKUP_DB_URL: Supabase direct DB or Session Pooler connection URL with sslmode=require. Use a database role allowed to read all included schemas. This is NOT an anon/publishable API key.
   - Repository VARIABLE named TRIPSPLIT_BACKUP_AGE_RECIPIENT: the age1... PUBLIC recipient from the second command.
   - Keep repository VARIABLE TRIPSPLIT_BACKUP_ENABLED UNSET initially.

3. After PR review and merge to main, run GitHub Actions -> TripSplit encrypted offsite database backup -> Run workflow -> mode BACKUP once. Verify the job succeeds and download the encrypted artifact to your own computer.

4. Verify decryption on your own trusted device without placing the private key in GitHub:

       age -d -i tripsplit-identity.txt -o tripsplit.tar tripsplit-YYYYMMDDTHHMMSSZ.tar.age
       tar -xf tripsplit.tar
       sha256sum -c SHA256SUMS
       pg_restore --list tripsplit.dump

   Run in a private local directory; delete plaintext after verification.

5. Restore into a SEPARATE Supabase-compatible staging environment. Compare trip, member, expense, settlement and auth data counts and test app access. This is more involved than simply importing over an existing managed Auth schema; use Supabase's managed-instance migration guide, validate roles and extensions, and **never use --clean against production.**

6. Only once the actual encrypted export and staging restore are validated: set TRIPSPLIT_BACKUP_ENABLED=true. Daily schedule then becomes active. Check repository artifact retention is >=35 days.

## Smoke-test behavior

PR CI creates two temporary databases and a throwaway encryption identity, backs up synthetic trip/ledger/identity/migration data using the same backup script, decrypts it with the matching private key, verifies SHA-256, restores to the second database and compares record counts and totals. A random other key must fail to decrypt it. No real Supabase credentials are used.

## Caveats and maintenance

- Production backup is READ-ONLY; does not modify existing trips or Auth accounts.
- Temporary plaintext lives only on ephemeral GitHub runner disk and is removed at exit. Only age ciphertext is uploaded.
- The private encryption key is intentionally NOT in GitHub Actions; this prevents completely automated decryption of real backups. A monthly real staging restore requires a person or a separately approved controlled key store.
- GitHub scheduled workflow runs can be delayed or skipped. Monitor missing/failed backups: failure notifications alone will not tell you about a schedule that never ran.
- The database URL must use session pooling/direct mode (not transaction pooling) and a DB role with sufficient privileges. A GitHub-hosted runner must be able to reach that endpoint.
- Only 35 days of encrypted artifacts are retained. A second private, independent archive destination would be needed for durable long-term backups.
