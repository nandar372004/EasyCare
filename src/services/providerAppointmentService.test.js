import { describe, expect, it, vi } from 'vitest'
import { createProviderAppointmentService } from './providerAppointmentService.js'
describe('provider appointment RPC boundary', () => {
  it('uses only server-resolved identity RPCs without caller provider or patient identity', async () => {
    const client={rpc:vi.fn().mockResolvedValueOnce({data:[{id:'own'}],error:null}).mockResolvedValueOnce({data:'confirmed',error:null})}
    const service=createProviderAppointmentService(client)
    expect(await service.list()).toEqual([{id:'own'}]);expect(await service.transition('own','confirmed')).toBe('confirmed')
    expect(client.rpc.mock.calls).toEqual([['list_my_provider_appointments'],['transition_my_provider_appointment',{p_appointment_id:'own',p_status:'confirmed'}]])
  })
  it('rejects unsupported actions and backend denial or malformed results', async () => {
    const client={rpc:vi.fn().mockResolvedValue({data:null,error:{code:'42501'}})};const service=createProviderAppointmentService(client)
    await expect(service.transition('own','pending')).rejects.toThrow(/Invalid/);expect(client.rpc).not.toHaveBeenCalled()
    await expect(service.transition('own','completed')).rejects.toThrow(/Unable/)
    await expect(service.list()).rejects.toThrow(/Unable/)
  })
})
