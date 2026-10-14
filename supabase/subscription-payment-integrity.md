# Security Repair 9 — Subscription-to-payment patient integrity

## Root cause and existing workflow

`payments` stores a non-null patient (`patient_id`), an authenticating payer (`payer_profile_id`),
optional `appointment_id` and `subscription_id` references, amount, currency, status,
and timestamps. At least one reference (`appointment_id` or `subscription_id`) is required;
both are permitted.

Before this repair, `payments` had single-column foreign keys to `subscriptions(id)` and
(via Repair 6) a composite foreign key to `appointments(id, patient_id)`. The creation
RLS policy (`payments_create`) verified `payments.payer_profile_id = auth.uid()` and
invoked `can_create_payment_for_appointment(payments.appointment_id, payments.patient_id)`.
When `payments.appointment_id` was `NULL` (a subscription-only payment), that helper
only evaluated `can_access_patient(payments.patient_id, 'payments')`.

Consequently, when Patient A created a subscription payment under Patient A's identity
(`payments.patient_id = Patient A`, `payments.payer_profile_id = Profile A`), RLS
permitted the insert because Patient A is authorized for Patient A. However, Patient A
could pass Patient B's `subscription_id`. The single-column foreign key only verified
that `subscription_id` existed, not that it belonged to Patient A. This allowed Patient A
to attach an owned payment row to an unrelated patient's subscription.

## Inspection findings

1. **How payments reference subscriptions**: via `payments.subscription_id uuid references public.subscriptions(id) on delete restrict`.
2. **How subscriptions identify their patient**: via `subscriptions.patient_id uuid not null references public.patients(id) on delete restrict`.
3. **Whether `subscription_id` is nullable**: Yes. Appointment-only payments have `subscription_id IS NULL`.
4. **Permissible references**: A check constraint (`check(appointment_id is not null or subscription_id is not null)`) permits appointment-only, subscription-only, or hybrid (both) payments. Neither being set is disallowed.
5. **Authorized family payments**: Legitimate family payers are modeled via `family_authorizations(patient_id, family_profile_id, can_make_payments)`. When a family member pays, `payments.payer_profile_id` is the family profile (`auth.uid()`), while `payments.patient_id` remains the patient receiving care (`subscriptions.patient_id`). The payment patient and subscription patient therefore still match.
6. **Service-role writes**: Trusted workers, webhook processors, and administrators update payment statuses (e.g., to `'paid'`, setting `paid_at` and `transaction_reference`) or import financial records.

## Changes

Forward migration: `migrations/20261002130000_subscription_payment_integrity.sql`.

- Locks `public.subscriptions` and `public.payments` in `SHARE ROW EXCLUSIVE` mode with a 10-second `lock_timeout`.
- Executes an atomic preflight check for any non-null `subscription_id` referencing a missing subscription or mismatched `patient_id`. If found, halts migration with `23514` without altering financial records.
- Adds `subscriptions_id_patient_key` unique constraint on `subscriptions(id, patient_id)`.
- Adds validated, non-deferrable composite foreign key `payments_subscription_patient_fk` on `payments(subscription_id, patient_id)` referencing `subscriptions(id, patient_id)` with `MATCH SIMPLE` and `ON UPDATE RESTRICT ON DELETE RESTRICT`.
- Adds a partial supporting index `payments_subscription_patient_idx` on `payments(subscription_id, patient_id) WHERE subscription_id IS NOT NULL`.
- `MATCH SIMPLE` ensures valid appointment-only rows (`subscription_id IS NULL`) remain valid while `patient_id` remains `NOT NULL`.

RLS changes: none. Helper/RPC changes: none. Grants: unchanged. Application/Edge changes: none.
All new SQL references are fully qualified.

## Read-only preflight

`scripts/subscription_payment_validation.sql` reports:
1. Non-null `subscription_id` links with missing subscriptions or different patient IDs (`structural_blocker = true`).
2. Care package price discrepancies for operator financial review without altering amounts.

In clean environments, zero inconsistent rows were found. A synthetic corrupted fixture verified that the preflight detects the mismatch and migration aborts safely with `23514`.

## Validation

`src/lib/subscriptionPaymentIntegrity.integration.test.js` adds 24 PostgreSQL/PGlite tests:
- Preserves historical payments, package relationships, and RLS policies.
- Authorized patient creates valid subscription payment and reads it (other patient cannot).
- Legitimate appointment payment from Repair 6 continues working.
- Legitimate hybrid payment referencing both appointment and subscription works.
- Authorized family payer creates subscription payment and reads it.
- Exact audit exploit: Patient A payment referencing Patient B subscription fails at database boundary (`23503`, constraint `payments_subscription_patient_fk`).
- Patient B payment referencing Patient A subscription fails (`23503`).
- Direct `authenticated` and `service_role` cross-patient inserts fail (`23503`).
- Service role cannot corrupt `subscription_id` or `patient_id` via `UPDATE` (`23503`).
- Service role valid status processing (`paid`, `paid_at`, `transaction_reference`) works.
- Family payer cannot attach payment to wrong patient subscription (`23503`).
- Patient cannot use foreign patient identity (`42501`).
- Revoked family payer cannot create payments (`42501`).
- Anonymous caller cannot create payments (`42501`).
- Patient has no direct `UPDATE` or `DELETE` privileges.
- Still enforces at-least-one-parent `CHECK` constraint (`23514`).
- Hybrid payment cannot reference foreign subscription (`23503`).
- Hybrid payment cannot reference foreign appointment (`42501`).
- Parent subscription patient mutation is restricted (`23001`).
- Parent subscription deletion is restricted while referenced (`23001`).
- Independent exploit retest (accepted before repair, denied after repair with `23503`).
- Preflight detects inconsistent subscription payment and migration aborts atomically (`23514`).

## Independent exploit retest

Outside the main suite in an isolated test transaction:
- **Before Repair 9**: Patient A created subscription payment under Patient A's identity referencing Patient B's subscription: **ACCEPTED**.
- **After Repair 9**: Repeated the exact attack: **DENIED** with error `23503` (foreign key constraint `payments_subscription_patient_fk`).
- Both attempts were rolled back; zero corrupt rows remained.

## Files and operational considerations

Four new files created:
- `supabase/migrations/20261002130000_subscription_payment_integrity.sql`
- `supabase/scripts/subscription_payment_validation.sql`
- `src/lib/subscriptionPaymentIntegrity.integration.test.js`
- `supabase/subscription-payment-integrity.md`

No changes were made to existing application code or old migrations.
Nothing was deployed to hosted Supabase.
Stopped after Repair 9.
