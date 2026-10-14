import { describe, expect, it, vi } from 'vitest'
import {
  createDoctorProfessionalInformationService,
  DOCTOR_MEDICAL_LICENSE_BUCKET,
  DOCTOR_MEDICAL_LICENSE_MAX_SIZE,
  validateDoctorMedicalLicense,
} from './doctorProfessionalInformationService.js'

describe('doctor professional information service', () => {
  it('accepts supported private license file types up to 10 MB', () => {
    expect(() => validateDoctorMedicalLicense({ name: 'license.pdf', type: 'application/pdf', size: DOCTOR_MEDICAL_LICENSE_MAX_SIZE })).not.toThrow()
    expect(() => validateDoctorMedicalLicense({ name: 'license.jpg', type: 'image/jpeg', size: 30 })).not.toThrow()
    expect(() => validateDoctorMedicalLicense({ name: 'license.gif', type: 'image/gif', size: 30 })).toThrow(/PDF, JPG, or PNG/)
    expect(() => validateDoctorMedicalLicense({ name: 'license.png', type: 'image/png', size: DOCTOR_MEDICAL_LICENSE_MAX_SIZE + 1 })).toThrow(/10 MB/)
  })

  it('loads owner-scoped metadata by provider id', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { provider_id: 'doctor-1', nrc: 'private-value' }, error: null })
    const eq = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    const service = createDoctorProfessionalInformationService({ from })
    expect(await service.load('doctor-1')).toMatchObject({ nrc: 'private-value' })
    expect(from).toHaveBeenCalledWith('doctor_professional_information')
    expect(eq).toHaveBeenCalledWith('provider_id', 'doctor-1')
  })

  it('creates a short lived private URL only for the signed-in owner path', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://private.example/license' }, error: null })
    const from = vi.fn(() => ({ createSignedUrl }))
    const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'profile-1' } }, error: null }) }, storage: { from } }
    const service = createDoctorProfessionalInformationService(client)
    expect(await service.createLicenseUrl('profile-1/doctor-1/file.pdf')).toBe('https://private.example/license')
    expect(from).toHaveBeenCalledWith(DOCTOR_MEDICAL_LICENSE_BUCKET)
    expect(createSignedUrl).toHaveBeenCalledWith('profile-1/doctor-1/file.pdf', 60)
    await expect(service.createLicenseUrl('another-profile/doctor-1/file.pdf')).rejects.toThrow(/unavailable/)
  })
})
