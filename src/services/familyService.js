import { normalizeFamilyRelationship, withViewerRelationships } from './familyRelationship.js'
import { createFamilyRepository } from './repositories/familyRepository.js'

// Auth.uid() is authoritative in every RPC. This API accepts group/membership
// identifiers only; it never accepts a clinical patient or viewer profile ID.
export function createFamilyService(repository = createFamilyRepository()) {
  return {
    ...repository,
    async getFamilyMembers(groupId) { return withViewerRelationships(await repository.getFamilyMembers(groupId), { groupId }) },
    async loadMyFamilyManagement() {
      const names = ['groups', 'invitations']
      const results = await Promise.allSettled(names.map(name => Promise.resolve().then(() => name === 'groups' ? repository.getMyFamilyGroups() : repository.getMyFamilyInvitations())))
      return Object.fromEntries(results.map((result, i) => [names[i], result.status === 'fulfilled' ? { status: 'ready', data: result.value } : { status: 'error', data: null }]))
    },
    createFamilyGroup(displayName) {
      const name = displayName?.trim()
      if (!name || name.length > 100) throw new Error('Enter a family name of 1–100 characters.')
      return repository.createFamilyGroup(name)
    },
    inviteFamilyMember(groupId, code, relationship) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code?.trim() || '')) throw new Error('Enter the invitation code shared by your family member.')
      const normalized = normalizeFamilyRelationship(relationship)
      if (!normalized) throw new Error('Choose a supported family relationship.')
      return repository.inviteFamilyMember(groupId, code.trim(), normalized)
    },
  }
}
export const familyService = createFamilyService()
