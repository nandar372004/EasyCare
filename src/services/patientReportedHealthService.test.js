import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addMyReportedHealthItem, addMyReportedVaccination, archiveMyReportedHealthItem, getMyReportedHealthIntake, saveMyReportedBloodType, updateMyReportedHealthItem, updateMyReportedVaccination } from './patientReportedHealthService.js'

const client = { rpc: vi.fn() }
beforeEach(() => client.rpc.mockReset().mockResolvedValue({ data: { items: [] }, error: null }))

describe('patient-reported health service', () => {
  it('uses only session-bound RPCs and sends no patient identity argument', async () => {
    await getMyReportedHealthIntake(client)
    await saveMyReportedBloodType('Unknown', client)
    await addMyReportedHealthItem({ itemType: 'allergy', name: 'Penicillin', details: { reaction: 'Rash' } }, client)
    await updateMyReportedHealthItem({ id: 'item-id', name: 'Penicillin', details: {} }, client)
    await archiveMyReportedHealthItem('item-id', client)
    await addMyReportedVaccination({ name: 'Influenza', dateGiven: '2026-10-01', doseNumber: 'Dose 1' }, client)
    await updateMyReportedVaccination({ id: 'vax-id', name: 'Influenza', dateGiven: '2026-10-01' }, client)
    expect(client.rpc.mock.calls).toEqual([
      ['get_my_reported_health_intake'],
      ['save_my_reported_blood_type', { p_blood_type: 'Unknown' }],
      ['add_my_reported_health_item', { p_item_type: 'allergy', p_entry_kind: 'item', p_item_name: 'Penicillin', p_details: { reaction: 'Rash' } }],
      ['update_my_reported_health_item', { p_item_id: 'item-id', p_item_name: 'Penicillin', p_details: {} }],
      ['archive_my_reported_health_item', { p_item_id: 'item-id' }],
      ['add_my_reported_vaccination', { p_item_name: 'Influenza', p_details: { dateGiven: '2026-10-01', doseNumber: 'Dose 1' } }],
      ['update_my_reported_vaccination', { p_item_id: 'vax-id', p_item_name: 'Influenza', p_details: { dateGiven: '2026-10-01' } }],
    ])
    expect(JSON.stringify(client.rpc.mock.calls)).not.toContain('patientId')
    expect(JSON.stringify(client.rpc.mock.calls)).not.toContain('profileId')
  })

  it('rejects invalid blood types and empty item identifiers before making requests', async () => {
    await expect(saveMyReportedBloodType('A++', client)).rejects.toThrow('Choose a valid blood type.')
    await expect(updateMyReportedHealthItem({ id: 'item-id', name: '  ' }, client)).rejects.toThrow('A name is required.')
    await expect(archiveMyReportedHealthItem('', client)).rejects.toThrow('A reported item is required.')
    await expect(addMyReportedVaccination({ name: 'Flu', dateGiven: '2026-02-30' }, client)).rejects.toThrow('Enter a valid date given.')
    expect(client.rpc).not.toHaveBeenCalled()
  })
})
