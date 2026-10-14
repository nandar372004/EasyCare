import { describe, expect, it, vi } from 'vitest'
import { createFamilyRepository } from './repositories/familyRepository.js'
import { createFamilyService } from './familyService.js'
const group = '99000000-0000-4000-8000-000000000011'
const code = '99000000-0000-4000-8000-000000000022'
describe('family repository and service boundaries', () => {
  it('uses scoped RPCs and sends no caller patient/profile identifiers', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [] })
    const service = createFamilyService(createFamilyRepository({ rpc }))
    await service.getMyFamilyGroups()
    await service.getFamilyMembers(group)
    await service.getMyFamilyInvitations()
    await service.createFamilyGroup(' My family ')
    await service.createFamilyJoinCode()
    await service.inviteFamilyMember(group, ` ${code} `, 'parent')
    await service.acceptFamilyInvitation('invitation')
    await service.declineFamilyInvitation('invitation')
    await service.cancelFamilyInvitation('invitation')
    await service.removeFamilyMember('member')
    await service.grantFamilyAuthorization('member', { records: true }, '2030-01-01T00:00Z')
    await service.revokeFamilyAuthorization('authorization')
    expect(rpc).toHaveBeenCalledWith('invite_family_member', { p_group_id: group, p_join_code: code, p_relationship: 'parent' })
    expect(rpc).toHaveBeenCalledWith('create_family_group', { p_display_name: 'My family' })
    expect(rpc).toHaveBeenCalledWith('grant_family_authorization', { p_viewer_member_id: 'member', p_permissions: { records: true }, p_expires_at: '2030-01-01T00:00Z' })
    for (const [, args] of rpc.mock.calls) expect(Object.keys(args).some(key => /patient|profile/.test(key))).toBe(false)
    expect(rpc).toHaveBeenCalledTimes(12)
  })
  it('preserves unrelated sections when an invitation query fails', async () => {
    const repo = { getMyFamilyGroups: vi.fn().mockResolvedValue([{ id: group }]), getMyFamilyInvitations: vi.fn().mockRejectedValue(new Error('denied')) }
    const result = await createFamilyService(repo).loadMyFamilyManagement()
    expect(result.groups).toEqual({ status: 'ready', data: [{ id: group }] })
    expect(result.invitations.status).toBe('error')
  })
  it('never loads fixtures or leaks database details', async () => {
    await expect(createFamilyRepository(null).getMyFamilyGroups()).rejects.toThrow(/unavailable/)
    const repo = createFamilyRepository({ rpc: async () => ({ error: { message: 'PRIVATE DATABASE DETAILS', code: '42501' } }) })
    await expect(repo.getMyFamilyGroups()).rejects.toThrow('Unable to complete this family operation.')
  })
  it('rejects invalid names and codes before calling the repository', () => {
    const repo = { createFamilyGroup: vi.fn(), inviteFamilyMember: vi.fn() }
    const service = createFamilyService(repo)
    expect(() => service.createFamilyGroup(' ')).toThrow(/family name/)
    expect(() => service.inviteFamilyMember(group, 'phone/email/patient search', 'parent')).toThrow(/invitation code/)
    expect(repo.createFamilyGroup).not.toHaveBeenCalled()
    expect(repo.inviteFamilyMember).not.toHaveBeenCalled()
  })
})

it('stores only trimmed lowercase recognized relationship values',async()=>{
  const invite=vi.fn().mockResolvedValue('invitation')
  const service=createFamilyService({inviteFamilyMember:invite})
  await service.inviteFamilyMember(group,code,' FRIEND ')
  await service.inviteFamilyMember(group,code,' Lover ')
  expect(invite).toHaveBeenNthCalledWith(1,group,code,'friend')
  expect(invite).toHaveBeenNthCalledWith(2,group,code,'lover')
  expect(()=>service.inviteFamilyMember(group,code,'unknown')).toThrow(/supported/)
  expect(invite).toHaveBeenCalledTimes(2)
})
