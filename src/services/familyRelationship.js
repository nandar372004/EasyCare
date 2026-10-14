const labels = Object.freeze({self:'Self',father:'Father',mother:'Mother',parent:'Parent',child:'Child',spouse:'Spouse',friend:'Friend',lover:'Lover',sibling:'Sibling',guardian:'Guardian',dependent:'Dependent',other:'Family member'})
const inverseLabels = Object.freeze({father:'Child',mother:'Child',parent:'Child',child:'Parent',spouse:'Spouse',friend:'Friend',lover:'Lover',sibling:'Sibling'})
const fallback = 'Family member'
export const normalizeFamilyRelationship = relationship => {
  const value = typeof relationship === 'string' ? relationship.trim().toLowerCase() : null
  return value && Object.hasOwn(labels, value) ? value : null
}
export const familyRelationshipLabel = relationship => labels[normalizeFamilyRelationship(relationship)] || fallback
export const inverseFamilyRelationship = relationship => inverseLabels[normalizeFamilyRelationship(relationship)] || fallback
const validId = id => typeof id === 'string' && id.length > 0

// Display only. acceptedSameFamily is established by the scoped directory adapter,
// never by relationship strings. No relationship can grant access to data.
export function resolveFamilyRelationship({ ownerPatientId, viewerPatientId, targetPatientId,
  viewerRelationshipToOwner, targetRelationshipToOwner, acceptedSameFamily = false } = {}) {
  if (validId(viewerPatientId) && viewerPatientId === targetPatientId) return 'Self'
  if (![ownerPatientId, viewerPatientId, targetPatientId].every(validId)) return fallback
  const viewerRelationship = normalizeFamilyRelationship(viewerRelationshipToOwner)
  const targetRelationship = normalizeFamilyRelationship(targetRelationshipToOwner)
  if (viewerPatientId === ownerPatientId) return targetRelationship === 'self' ? fallback : familyRelationshipLabel(targetRelationship)
  if (targetPatientId === ownerPatientId) return inverseFamilyRelationship(viewerRelationship)
  if (acceptedSameFamily) {
    if (viewerRelationship === 'mother' && targetRelationship === 'father') return 'Husband'
    if (viewerRelationship === 'father' && targetRelationship === 'mother') return 'Wife'
  }
  return fallback
}

export function resolveInvitationRelationship(relationship, incoming) {
  return resolveFamilyRelationship({
    ownerPatientId: 'inviter', viewerPatientId: incoming ? 'invitee' : 'inviter',
    targetPatientId: incoming ? 'inviter' : 'invitee',
    viewerRelationshipToOwner: incoming ? relationship : 'self', targetRelationshipToOwner: relationship,
  })
}

// RPCs return accepted members of one authorized group. Management RPCs expose
// opaque membership IDs instead of patient IDs; those IDs are used only for display.
export function withViewerRelationships(members, { groupId, viewerPatientId } = {}) {
  const identity = member => member.patient_id || `membership:${member.member_id || member.id || members.indexOf(member)}`
  const viewers = members.filter(member => viewerPatientId ? member.patient_id === viewerPatientId : member.is_self)
  const owners = members.filter(member => member.role === 'owner')
  const viewer = viewers.length === 1 ? viewers[0] : null
  const owner = owners.length === 1 ? owners[0] : null
  const belongsToGroup = member => {
    if (!member || (member.status && member.status !== 'active' && member.status !== 'accepted')) return false
    const recordedGroup = member.family_group_id || member.groupId
    return Boolean(groupId) && (!recordedGroup || recordedGroup === groupId)
  }
  return members.map(member => {
    const acceptedSameFamily = [viewer, owner, member].every(belongsToGroup)
    const mismatchedGroup = groupId && [viewer, owner, member].some(row => row && (row.family_group_id || row.groupId) && (row.family_group_id || row.groupId) !== groupId)
    return {...member, relationshipLabel: resolveFamilyRelationship({
      ownerPatientId: !mismatchedGroup && owner ? identity(owner) : null,
      viewerPatientId: viewerPatientId || (viewer ? identity(viewer) : null),
      targetPatientId: identity(member), viewerRelationshipToOwner: viewer?.relationship,
      targetRelationshipToOwner: member.relationship, acceptedSameFamily,
    })}
  })
}
