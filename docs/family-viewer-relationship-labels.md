# Canonical viewer-relative family relationships — Step 3

resolveFamilyRelationship in src/services/familyRelationship.js is the shared
pure display resolver. Its identity rule is viewerPatientId === targetPatientId
=> Self, before all other rules. Owner views use normalized recorded labels.
Members viewing the owner use neutral inverses: mother/father/parent => Child,
child => Parent, symmetric Spouse/Sibling/Friend/Lover, and Guardian/Other =>
Family member. Unknown/null/non-string values never produce a raw UI label.

Step 3 explicitly introduces one product-specific non-owner inference:
mother viewing father => Husband, father viewing mother => Wife. This replaces
the earlier neutral parent-pair display. It does not use or fabricate profile
gender. All other non-owner pairs remain Family member. Explicit Lover never
becomes Spouse, Husband or Wife; explicit Spouse stays Spouse.

The resolver defaults acceptedSameFamily to false. withViewerRelationships
establishes this context only for a directory requested for one authorized group,
with one viewer and one owner. Returned RPC rows are accepted members of that
group. Explicit conflicting group IDs, removed/pending rows or ambiguous owners
prevent parent-pair inference. Unscoped arrays do not infer Husband/Wife.
Management RPCs expose membership IDs rather than patient UUIDs; the adapter
uses these opaque identities only for display. The health directory supplies
actual patient IDs. No extra backend query or identity disclosure is added.

Management and health services both use the directory adapter. Overview cards,
member choices and shared-care headers consume relationshipLabel. Incoming and
outgoing invitation cards call resolveInvitationRelationship, which delegates
to the same canonical resolver. Raw relationship, membership and authorization
fields remain unchanged. Group creator metadata does not determine the viewer.

No migration, RLS change, clinical write, provider access change, service-role
browser access or automatic overview refresh is introduced. Tests cover the
complete owner/inverse matrix, self identity, normalized and unknown values,
parent pairs, non-owner fallback, cross-group/removed-member rejection, management,
overview and shared-care views. Existing authorization/provider tests remain
part of the focused validation. No deployment or Phase K work is performed.
