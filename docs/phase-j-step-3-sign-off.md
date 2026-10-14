# Phase J Step 3 — Verification and sign-off status

Final sign-off is pending live authenticated Staging verification. No deployment
or Phase K work was performed. The local checks are successful; they must not be
described as hosted-account verification.

## Defects corrected

- Revoked, expired, inactive or unshared member readouts no longer produce member
  cards or protected signals in the overview. Accepted relationships remain in
  Health Circle management; the overview explains when sharing is unavailable.
- Grant expiry is checked again when concurrent readouts are assembled, preventing
  a grant that expires during another slow read from entering the returned model.
- Detailed family requests use generation counters. An older response cannot
  restore a protected section after a newer refresh, selection, or unmount.
- Unrelated, removed, revoked and expired membership deep links show an unavailable
  state. They do not silently display a different family's care as the destination.
- Long-term expiry timers are capped at the browser timeout maximum, avoiding a
  rapid refresh loop for grants more than approximately 24.8 days in the future.
- Equivalent patient objects no longer trigger duplicate overview loads.
- Long names, relationship labels, chips and action buttons wrap without overflow.

## Local verification evidence

The tests exercise real repository migration-chain PostgreSQL RLS locally,
service grant filtering and refresh races, direct member-route denial, exact
grant expiry, account-switch clearing, current status priorities, one primary
action, and rejection of candidate values as clinical truth.

Every CTA destination is checked against the actual App route tree and real
patient route guard. Destination components are stubbed in that routing suite;
the detailed member page and authorization lifecycle have separate component
tests, and database authorization has separate RLS tests. Back navigation and
provider route separation are tested.

Browser layout checks use isolated temporary fixtures, never application demo
data: 320 px mobile, 768 px tablet and 1280 px desktop. A long unbroken name
initially overflowed its expansion button; after correction, both collapsed and
expanded layouts had no document or button overflow. Temporary fixture source is
removed after checking. A test-only layout screenshot is retained in tmp.

There are no new migrations, RLS policies, clinical write calls, browser
service-role credentials or patient identifier logs in the Phase J code paths.
Existing browser configuration tests reject service-role and secret keys.
The overview retains two required directory reads per group and existing scoped
clinical reads; no cross-request authorization cache is introduced.

Remote revocation is enforced immediately by database authorization. Open UI
pages recheck on refresh/focus and at 15-second intervals; they do not have a
push guarantee for an external revocation before those checks. Existing grant
expiry clears the overview at its expiry timer. Refresh clears visible content
while access is revalidated and ignores stale completions.

## Live verification gap

The configured Staging project matches the repository's prior Staging target.
No owner/viewer/unrelated-patient login credentials were found in the inspected
configuration. The existing “Staging credential” PDF is a medical-document test
fixture, not login credentials. Account details were requested from the user.

A read-only anonymous boundary probe was attempted. The sandbox initially blocked
DNS; the authorized outside-sandbox attempt then timed out connecting to Staging.
No successful hosted anonymous or authenticated authorization result was obtained.
The replayable probe script prints only safe result flags and error codes, never
keys or patient data. No grants, memberships, accounts, consent or clinical
records were changed on Staging.

Required before sign-off: accessible Staging and designated existing test
credentials, then owner/shared-viewer/unrelated-patient checks, permission
revocation, expiry, removal, and live CTA behavior with real stored records.

Phase J sign-off: FAIL / pending live verification.
Safe to start Phase K AI Guardian: NO.

Final checks: 151 tests passed across 11 suites; production build passed with
the existing large-bundle advisory; `git diff --check` and whitespace checks for
the new Phase J files passed.
