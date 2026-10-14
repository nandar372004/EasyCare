import { supabase } from '../../lib/supabase.js'
import { createPatientDashboardRepository } from './patientDashboardRepository.js'
import { createDocumentHealthIntelligenceService } from '../documentHealthIntelligenceService.js'

function queryData(result) {
  if (result.error) {
    const error = new Error('Unable to load authorized family health data.')
    error.code = result.error.code
    throw error
  }
  return result.data
}

export function createFamilyHealthRepository(client = supabase, dashboardRepository) {
  if (!client) throw new Error('Family Health requires a configured EasyCare account.')
  const dashboard = dashboardRepository || createPatientDashboardRepository(client)
  const documentIntelligence = createDocumentHealthIntelligenceService(client)
  return {
    async getGroups() {
      const { data, error } = await client.rpc('get_my_family_groups')
      if (error) throw new Error('Unable to load your family groups.')
      return data || []
    },
    async getMembers(groupId) {
      const { data, error } = await client.rpc('get_family_health_members', { p_group_id: groupId })
      if (error) throw new Error('Unable to load eligible family members.')
      return data || []
    },
    async getFamilyCarePlans(groupId, memberId) {
      const { data, error } = await client.rpc('get_family_care_plan_readout', { p_group_id: groupId, p_member_id: memberId })
      return queryData({ data, error }) || []
    },
    async getFamilyPatientCarePlan(groupId, memberId) {
      const { data, error } = await client.rpc('get_family_patient_care_plan_readout', { p_group_id: groupId, p_member_id: memberId })
      return queryData({ data, error })
    },
    async getFamilyReportedHealthRecords(groupId, memberId) {
      const { data, error } = await client.rpc('get_family_reported_health_records', { p_group_id: groupId, p_member_id: memberId })
      const intake = queryData({ data, error })
      return (intake?.items || []).filter(item => item.entryKind === 'item' && ['allergy', 'condition', 'vaccination'].includes(item.itemType)).map(item => ({
        kind: 'reported',
        recordedAt: item.itemType === 'vaccination' ? item.details?.dateGiven : item.updatedAt || item.createdAt,
        record: {
          id: item.id,
          title: item.name,
          type: item.itemType === 'allergy' ? 'Allergy' : item.itemType === 'condition' ? 'Condition' : 'Vaccination',
          details: item.details || {},
          verification_status: item.verificationStatus,
        },
      }))
    },
    async getFamilyMedicalDocuments(patientId) {
      const { data, error } = await client.from('clinical_documents')
        .select('id,patient_id,title,description,document_type,document_date,original_filename,storage_bucket,storage_path,source,status,created_at')
        .eq('patient_id', patientId).eq('status', 'active').eq('source', 'patient_upload')
        .order('created_at', { ascending: false }).order('id').limit(20)
      return (queryData({ data, error }) || []).filter(row => row.patient_id === patientId)
        .map(row => ({ kind: 'document', recordedAt: row.document_date || row.created_at, record: row }))
    },
    getNextAppointment: patientId => dashboard.getNextAppointment(patientId),
    getUpcomingAppointments: patientId => dashboard.getUpcomingAppointments(patientId),
    async getCommandAppointments(patientId, at = new Date(), { includeDashboardFields = false } = {}) {
      const rows = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('appointments')
          .select(`id,patient_id,scheduled_start,scheduled_end,status,created_at,updated_at${includeDashboardFields ? ',provider_id,appointment_type,consultation_channel,reason_symptoms,booking_code' : ''}`)
          .eq('patient_id', patientId).in('status', ['pending', 'confirmed', 'rescheduled', 'completed'])
          .or(`status.neq.completed,updated_at.gte.${new Date(+at - 30 * 86400000).toISOString()}`)
          .order('scheduled_start').order('id').range(offset, offset + 499)
        const page = queryData({ data, error }) || []
        rows.push(...page.filter(row => row.patient_id === patientId).map(row => ({ id: row.id, ...(includeDashboardFields ? { patientId: row.patient_id, providerId: row.provider_id, appointmentType: row.appointment_type, consultationChannel: row.consultation_channel, reasonSymptoms: row.reason_symptoms, bookingCode: row.booking_code } : {}), scheduledStart: row.scheduled_start, scheduledEnd: row.scheduled_end, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })))
        if (page.length < 500) return rows
      }
    },
    async getCommandDocuments(patientId) {
      const { data, error } = await client.from('clinical_documents')
        .select('id,patient_id,created_at')
        .eq('patient_id', patientId).eq('status', 'active').eq('source', 'patient_upload')
        .order('created_at', { ascending: false }).order('id').limit(20)
      return (queryData({ data, error }) || []).filter(row => row.patient_id === patientId)
    },
    getLatestVitals: patientId => dashboard.getLatestVitals(patientId),
    getVitalHistory: (patientId, metric, period) => dashboard.getVitalHistory(patientId, metric, period),
    async getCommandFollowUps(patientId) {
      const rows = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('follow_ups')
          .select('id,patient_id,follow_up_type,due_at,status,completed_at')
          .eq('patient_id', patientId).in('status', ['pending', 'completed'])
          .order('due_at').order('id').range(offset, offset + 499)
        const page = queryData({ data, error }) || []
        rows.push(...page.filter(row => row.patient_id === patientId))
        if (page.length < 500) return rows
      }
    },
    async getMedications(patientId) {
      const { data, error } = await client.from('patient_medications')
        .select('id, medication_name, dose, instructions, start_date, end_date, status, medication_schedules(id, time_of_day, days_of_week, timezone, valid_from, valid_until)')
        .eq('patient_id', patientId).eq('status', 'active').order('start_date', { ascending: false }).limit(20)
      return queryData({ data, error }) || []
    },
    async getActiveAlerts(patientId) {
      const { data, error } = await client.from('monitoring_alerts')
        .select('id, alert_type, severity, status, title, message, detected_at, created_at')
        .eq('patient_id', patientId).in('status', ['open', 'acknowledged', 'escalated'])
        .order('created_at', { ascending: false }).order('id').limit(10)
      return queryData({ data, error }) || []
    },
    async getRecentHealthRecords(patientId) {
      const sources = [
        ['care_encounters', 'encounter', 'id, encounter_type, chief_complaint, assessment_summary, created_at', 'created_at'],
        ['clinical_documents', 'document', 'id, document_type, title, description, document_date, original_filename, storage_bucket, storage_path, source, status, created_at', 'created_at'],
        ['medical_history_items', 'history', 'id, category, title, occurred_on, details', 'occurred_on'],
      ]
      const results = await Promise.all(sources.map(async ([table, kind, columns, date]) => {
        const { data, error } = await client.from(table).select(columns).eq('patient_id', patientId)
          .order(date, { ascending: false, nullsFirst: false }).order('id').limit(10)
        return (queryData({ data, error }) || []).map(row => ({ kind, recordedAt: row[date], record: row }))
      }))
      return results.flat().sort((a, b) => (Date.parse(b.recordedAt) || 0) - (Date.parse(a.recordedAt) || 0)).slice(0, 20)
    },
    async createDocumentSignedUrl(patientId, documentId) {
      const { data: document, error: documentError } = await client.from('clinical_documents')
        .select('storage_bucket,storage_path,original_filename').eq('id', documentId).eq('patient_id', patientId)
        .eq('status', 'active').maybeSingle()
      if (documentError || !document?.storage_bucket || !document.storage_path) throw new Error('Unable to open this family document.')
      const { data, error } = await client.storage.from(document.storage_bucket)
        .createSignedUrl(document.storage_path, 60, { download: document.original_filename || true })
      if (error || !data?.signedUrl) throw new Error('Unable to open this family document.')
      return data.signedUrl
    },
    getRecentLabResults: patientId => dashboard.getRecentLabResults(patientId),
    async getDocumentFactIntelligence(patientId) {
      const result = await documentIntelligence.getOverviewForPatient(patientId)
      return result
    },
  }
}
