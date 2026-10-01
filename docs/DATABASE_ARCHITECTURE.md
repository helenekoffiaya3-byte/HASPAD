# HASPAD database architecture

## Authoritative runtime database

HASPAD production application data is **Netlify Database (PostgreSQL)**.

The runtime database is accessed through `@netlify/database` in `netlify/functions/_db.js`. Core application tables and deployment tables are versioned under:

- `netlify/database/migrations/001-haspad-core/migration.sql`
- `netlify/database/migrations/002-deployment-runtimes/migration.sql`
- `netlify/database/migrations/003-paas-runtime/migration.sql`

The credit/deployment lifecycle is implemented transactionally in `_db.js`:

- `consume_credits_and_create_build_v2`
- `fail_build_and_refund`
- `debit_user_credits`
- `refund_user_credits`
- `apply_payment_credits`

These are application-level RPC adapters backed by the Netlify Database connection pool; they are not Supabase RPCs.

## Supabase status

The historical Supabase project is **not an application runtime dependency of HASPAD main**.

The repository contains:

- no `@supabase/supabase-js` dependency;
- no `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` runtime dependency;
- no HASPAD function importing Supabase.

Therefore the existence of an older Supabase schema/migration history must not be treated as migration drift for the current HASPAD runtime. It is legacy infrastructure and must not be modified, migrated, or used for production credits without an explicit architecture decision.

## Credit safety invariant

A deployment must never lose user credits because of a failed build.

The canonical flow is:

1. authenticate the user and verify site ownership;
2. atomically allocate/debit credits and create `project_builds`;
3. run Gemini frontend generation;
4. run Claude backend generation;
5. run the ChatGPT integration gate;
6. trigger the selected runtime;
7. on immediate or reconciled failure, call `fail_build_and_refund`;
8. make refund accounting idempotent through `refunded_at` and the unique `(user_id, reference_id)` credit transaction key.

## Architectural rule

Do not add Supabase dependencies or Supabase migrations to the HASPAD production path unless the database authority is intentionally changed and the complete data/credit lifecycle is migrated under a separate, reviewed change.

Netlify Database migrations are the reproducible schema source for the current HASPAD application.
