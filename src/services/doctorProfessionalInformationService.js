import { supabase } from '../lib/supabase.js'

export const DOCTOR_MEDICAL_LICENSE_BUCKET = 'doctor-medical-licenses'
export const DOCTOR_MEDICAL_LICENSE_MAX_SIZE = 10 * 1024 * 1024
export const DOCTOR_LICENSE_TYPES = Object.freeze([
  { value: 'general_medical_practitioner', label: 'General Medical Practitioner' },
  { value: 'specialist_medical_practitioner', label: 'Specialist Medical Practitioner' },
  { value: 'limited_medical_practitioner', label: 'Limited Medical Practitioner' },
])

const mimeExtensions = Object.freeze({ 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'] })

export function validateDoctorMedicalLicense(file) {
  if (!file) return
  const extensions = mimeExtensions[file.type]
  const extension = String(file.name || '').split('.').at(-1).toLowerCase()
  if (!extensions || !extensions.includes(extension)) throw new Error('Upload a PDF, JPG, or PNG medical license.')
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > DOCTOR_MEDICAL_LICENSE_MAX_SIZE) {
    throw new Error('The medical license file must be 10 MB or smaller.')
  }
}

export function createDoctorProfessionalInformationService(client = supabase, randomUuid = () => globalThis.crypto.randomUUID()) {
  return {
    async load(providerId) {
      if (!client || !providerId) throw new Error('Doctor professional information is unavailable.')
      const { data, error } = await client.from('doctor_professional_information')
        .select('provider_id,full_name,nrc,date_of_birth,work_experience_years,current_hospital,medical_qualification,mmc_registration_number,medical_practitioner_license_number,license_type,medical_license_storage_path,medical_license_file_name,medical_license_mime_type')
        .eq('provider_id', providerId).maybeSingle()
      if (error) throw new Error('Unable to load professional information.')
      return data
    },
    async save(providerId, fields, file) {
      validateDoctorMedicalLicense(file)
      if (!client || !providerId) throw new Error('Doctor professional information is unavailable.')
      const { data: userData, error: userError } = await client.auth.getUser()
      const userId = userData?.user?.id
      if (userError || !userId) throw new Error('Sign in again to save professional information.')

      const { data: existing, error: loadError } = await client.from('doctor_professional_information')
        .select('medical_license_storage_path').eq('provider_id', providerId).maybeSingle()
      if (loadError) throw new Error('Unable to verify your current license document.')

      let storagePath = existing?.medical_license_storage_path || null
      let fileName = fields.medical_license_file_name || null
      let mimeType = fields.medical_license_mime_type || null
      if (file) {
        const safeName = String(file.name).normalize('NFKD').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'medical-license'
        storagePath = `${userId}/${providerId}/${randomUuid()}-${safeName}`
        fileName = safeName
        mimeType = file.type
        const { error: uploadError } = await client.storage.from(DOCTOR_MEDICAL_LICENSE_BUCKET)
          .upload(storagePath, file, { contentType: file.type, upsert: false })
        if (uploadError) throw new Error('Unable to upload the medical license. Please try again.')
      }

      const payload = {
        provider_id: providerId,
        full_name: fields.full_name.trim(),
        nrc: fields.nrc.trim(),
        date_of_birth: fields.date_of_birth,
        work_experience_years: Number(fields.work_experience_years),
        current_hospital: fields.current_hospital.trim() || null,
        medical_qualification: fields.medical_qualification.trim(),
        mmc_registration_number: fields.mmc_registration_number.trim(),
        medical_practitioner_license_number: fields.medical_practitioner_license_number.trim(),
        license_type: fields.license_type,
        medical_license_storage_path: storagePath,
        medical_license_file_name: fileName,
        medical_license_mime_type: mimeType,
      }
      const { data, error } = await client.from('doctor_professional_information')
        .upsert(payload, { onConflict: 'provider_id' }).select().single()
      if (error) {
        if (file && storagePath) await client.storage.from(DOCTOR_MEDICAL_LICENSE_BUCKET).remove([storagePath]).catch(() => {})
        throw new Error('Unable to save professional information. Please check the required fields and try again.')
      }
      if (file && existing?.medical_license_storage_path && existing.medical_license_storage_path !== storagePath) {
        await client.storage.from(DOCTOR_MEDICAL_LICENSE_BUCKET).remove([existing.medical_license_storage_path]).catch(() => {})
      }
      return data
    },
    async createLicenseUrl(storagePath) {
      if (!client || !storagePath) throw new Error('The license document is unavailable.')
      const { data: userData, error: userError } = await client.auth.getUser()
      if (userError || !userData?.user?.id || !storagePath.startsWith(`${userData.user.id}/`)) throw new Error('The license document is unavailable.')
      const { data, error } = await client.storage.from(DOCTOR_MEDICAL_LICENSE_BUCKET).createSignedUrl(storagePath, 60)
      if (error || !data?.signedUrl) throw new Error('Unable to open the private license document.')
      return data.signedUrl
    },
  }
}

export const doctorProfessionalInformationService = createDoctorProfessionalInformationService()
