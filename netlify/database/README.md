# HASPAD database authority

## Canonical production database

HASPAD production uses **Netlify Database (Postgres)** through `@netlify/database`.

Application database access is centralized in `netlify/functions/_db.js`. The deployment, credit, authentication shadow records, billing, runtime, and Base Studio data paths use this layer.

Netlify Database migrations live under:

`netlify/database/migrations/<number>-<slug>/migration.sql`

## Supabase

The historical Supabase project is **not a runtime dependency of HASPAD**. The application does not import `@supabase/supabase-js` and does not read `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`.

The historical Supabase schema must therefore not be treated as the source of truth for HASPAD production credits, deployments, authentication shadow records, or runtime state.

Do not perform a data migration from the historical Supabase project unless a future architecture decision explicitly makes Supabase authoritative.

## Credit safety invariant

A deployment debit and build allocation are performed by the Netlify Database transaction path in `_db.js`. Failed builds are refunded by the same database layer and recorded in `credit_transactions` with a per-build refund reference.

The application also prevents duplicate active deployments for the same site/repository/branch through the transactional site lock and the active-build invariant migration.

## Change policy

1. Add a new Netlify Database migration for schema changes.
2. Do not edit old migrations after they have reached production.
3. Never store API keys, OAuth secrets, encryption keys, or payment secrets in migration files.
4. Verify credit balance and credit transaction invariants after deployment changes.
