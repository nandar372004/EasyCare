import { supabase } from '../../lib/supabase.js'

export function createFamilyRepository(client = supabase) {
  const call = async (name, args = {}) => {
    if (!client) throw new Error('Family management is unavailable. Sign in with a configured EasyCare patient account.')
    const { data, error } = await client.rpc(name, args)
    if (error) {
      // Never forward database details, invitation/account existence or identifiers.
      throw new Error('Unable to complete this family operation. Check your access and try again.')
    }
    return data
  }
  return {
    getMyFamilyGroups: () => call('get_my_family_groups'),
    getFamilyMembers: groupId => call('get_family_members', { p_group_id: groupId }),
    getMyFamilyInvitations: () => call('get_my_family_invitations'),
    createFamilyGroup: displayName => call('create_family_group', { p_display_name: displayName }),
    createFamilyJoinCode: () => call('create_family_join_code'),
    inviteFamilyMember: (groupId, joinCode, relationship) => call('invite_family_member', { p_group_id: groupId, p_join_code: joinCode, p_relationship: relationship }),
    acceptFamilyInvitation: invitationId => call('respond_family_invitation', { p_invitation_id: invitationId, p_accept: true }),
    declineFamilyInvitation: invitationId => call('respond_family_invitation', { p_invitation_id: invitationId, p_accept: false }),
    cancelFamilyInvitation: invitationId => call('cancel_family_invitation', { p_invitation_id: invitationId }),
    removeFamilyMember: memberId => call('remove_family_member', { p_member_id: memberId }),
    grantFamilyAuthorization: (memberId, permissions, expiresAt) => call('grant_family_authorization', { p_viewer_member_id: memberId, p_permissions: permissions, p_expires_at: expiresAt }),
    revokeFamilyAuthorization: authorizationId => call('revoke_family_authorization', { p_authorization_id: authorizationId }),
  }
}
