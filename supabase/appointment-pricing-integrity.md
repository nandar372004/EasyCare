# Critical Security Repair 4 — Appointment fee and pricing integrity

## Architecture inspected and root cause

The real booking flow is `DoctorsPage` → `createSupabaseRepository.createAppointment`
→ direct INSERT into `appointments`. The page reads the doctor's
`consultation_fee_mmk` and sends it as `feeMmk`; the repository previously copied
it into `fee_amount`. A browser could replace it with zero, a reduced price or an
arbitrary price. The database checked only `fee_amount >= 0`, defaulted it to zero,
and never compared it to the provider. Its RLS validated ownership, verified doctor,
availability, time and service, but not price or currency.

The current appointment price source is `providers.consultation_fee_mmk`, an integer
MMK price shared by video, voice and home-visit bookings. Explicit zero is valid;
NULL is unconfigured, not free. The page previously displayed NULL as zero, but the
new database boundary will reject such bookings rather than invent a price.

`service_catalog`, `pricing_rules`, `care_packages`, `package_services`,
`subscriptions` and `payments` were inspected. No appointment service-catalog ID,
pricing-rule ID, entitlement-redemption record, or subscription/package relationship
exists. No booking code consumes those tables to calculate a patient charge. The
care-plan page has separate presentation pricing; it is not an appointment discount
engine. Therefore no implemented package/subscription appointment adjustment is
replaced, consumed or removed. This repair does not create one or interpret a
subscription as an automatic free appointment.

Availability identifies provider, service mode and exact time, enough to identify
the existing single provider price. It cannot identify a catalog product/rule or
package entitlement. No invalid rule ID can be submitted through the existing
appointment schema; free catalog rows cannot override the provider fee.

Patients already lack appointment UPDATE grants/policies in the latest migrations.
Trusted direct writes previously could alter price freely. No booking Edge Function
or booking-creation RPC exists. The repository references cancellation/rescheduling
RPCs that are absent from the current migrations; their implementation is outside
this repair. Existing slot-booking, overlap, audit, updated-at and Repair 2 parent
integrity triggers were reviewed and preserved.

## Trusted boundary and changes

Forward migration: `migrations/20261001120000_appointment_pricing_integrity.sql`.

A BEFORE INSERT OR UPDATE trigger calls `enforce_appointment_pricing()`. This is
the narrowest boundary that protects both the existing direct-insert repository
and privileged service-role writes without introducing a second booking API.

On INSERT it locks and reads the provider's authoritative fee, requires a verified
doctor with a configured fee, locks the availability row, and checks provider,
service, exact start/end and available status. It assigns `fee_amount` and `MMK`
regardless of submitted price/currency. Zero, reduced, inflated and NULL client
amounts cannot become authoritative. An explicit provider price of zero remains
valid. Unsupported provider pricing or missing availability fails closed even for
service-role writes. Existing AFTER INSERT slot marking and overlap/unique
constraints still apply. A failed insert rolls back slot changes atomically.

On UPDATE it rejects changes to fee, currency, provider, service mode, availability
or scheduled times, including privileged writes. These fields form an immutable
booking snapshot: changing them requires a new booking. Ordinary status/reason
changes remain subject to their existing permissions and constraints. Changing a
provider's rate never silently reprices an old booking. Historical suspicious prices
are preserved, including when unrelated fields are updated.

The function is SECURITY DEFINER with an empty search_path and fully qualified
references. Direct execution is revoked from PUBLIC/anon/authenticated; it can
only operate as a trigger. It does not grant a booking or bypass appointment RLS.
No RLS policy, table grant, old migration or Repair 1–3 file was modified.

The Supabase repository now omits fee/currency from the INSERT payload and uses
the returned database price. The page may still pass/display its price estimate;
it is ignored by the real repository. No visual design, fixture/demo booking,
payment logic or Edge Function changed.

## Preflight and historical data

Read-only query: `scripts/appointment_pricing_validation.sql`.

It reports paid-provider zero fees, reduced/arbitrary fees compared with the current
rate, missing/unreproducible prices, non-MMK currency, unsupported provider pricing,
and missing/mismatched availability/provider/service/time relationships.

**Historical rate versions do not exist.** A mismatch with today's price is a review
candidate, not proof of fraud or an instruction to reprice. The migration performs
no data UPDATE or automatic status correction. Two deliberately constructed local
historical test appointments were flagged for zero fees and missing slots; their
rows were verified unchanged. These are synthetic test findings, not production
findings. No persistent or hosted clinical dataset was audited in this repair.

## Tests and results

Final targeted run: **466 passed, 0 failed across 25 suites**.

- New PostgreSQL/PGlite pricing suite: **33 passed**. Real migration chain, triggers,
  constraints and RLS are exercised; managed Auth/Storage infrastructure is local.
- New repository payload test: **1 passed**. This small unit test uses a client spy
  to verify omitted price fields and use of the returned price; it is not evidence
  of database enforcement.
- Repair 1: **16 passed**; Repair 2: **32 passed**; Repair 3: **43 passed**.
- Additional full-chain Repair 4 cases verify all three earlier protections remain.
- Other passing suites cover booking validation, appointment contracts, slot/overlap
  protection, authentication, repositories and clinical RLS.

Tests cover paid/free/unconfigured pricing; zero/reduced/inflated/NULL client fees;
currency normalization; direct INSERT; patient and service-role UPDATE tampering;
snapshot preservation after rate changes; provider/service/time/slot mismatches;
unsupported provider types; anonymous/foreign-patient denial; unchanged RLS and
historical rows; unchanged Repairs 1–3. Catalog data is verified not to override
appointment pricing. There is no implemented package discount or real payment
processing test suite to validate; no such behavior is claimed to pass.

Known unrelated legacy suites requiring removed migrations and obsolete pgTAP
schemas were not run or repaired, and are not included in the passing count.
Earlier phase integration suites stop at their phase migration; the Repair 4 suite
replays through this migration and verifies the final database boundary.

## Files and deployment considerations

Created:

1. `supabase/migrations/20261001120000_appointment_pricing_integrity.sql`
2. `supabase/scripts/appointment_pricing_validation.sql`
3. `src/lib/appointmentPricingIntegrity.integration.test.js`
4. `src/services/repositories/appointmentPricingPayload.test.js`
5. `supabase/appointment-pricing-integrity.md`

Modified only the booking payload in the already-modified
`src/services/repositories/supabaseRepository.js`; all earlier edits were preserved.

Nothing was deployed to hosted Supabase. Before deployment, run the preflight in
an authorized environment and review any outside-repository booking integrations.
Privileged imports without availability, non-doctor appointments, unconfigured
prices, and direct rescheduling/repricing will now be rejected. No existing
repository-backed entitlement or working reschedule RPC was found, but any hosted
schema drift must be reviewed before applying this migration. Correcting historical
prices requires a separately reviewed administrative migration, not silent repair.

The existing source is one provider rate for all supported consultation modes;
future service-specific rates or package discounts require an explicit approved
pricing model. A rate may change between browser display and booking: the database
rate at INSERT is authoritative. A price-confirmation UX is not added here.
Validate hosted grants/JWT behavior and concurrent sessions in staging; PGlite
tests do not prove hosted concurrency behavior. Database owners can disable
triggers and remain a trusted administrative boundary. Provider rate-editing
permissions remain unchanged. Rollback should be a reviewed forward migration;
removing the trigger alone would reopen the vulnerability.

Stopped after Repair 4. No unrelated feature or notification repair was started.
