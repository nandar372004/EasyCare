import { visibleMedicationRecords } from '../medicationVisibility.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_SIZE = 500
const PROFILE = 'id, profile_id, full_name, date_of_birth, gender, primary_phone, preferred_language, address_line, township, city, blood_type, status'
// Keep this aligned with the Medications tab's supported Staging read contract.
const MEDICATIONS = 'id, patient_id, medication_name, dose, frequency, instructions, start_date, end_date, status, medication_schedules(id, time_of_day, days_of_week, timezone, valid_from, valid_until)'
const MEDICATION_CHECK_INS = 'id, patient_medication_id, patient_id, local_date, occurrence_index, is_prn, status, completed_at, request_id, created_at'
const METRICS = Object.freeze({
  blood_pressure: ['systolic_bp', 'diastolic_bp'], heart_rate: ['heart_rate'],
  oxygen_saturation: ['spo2'], temperature: ['temperature_c'], blood_glucose: ['glucose_mg_dl'], weight_kg: ['weight_kg'],
})
const ALIASES = { spo2: 'oxygen_saturation', temperature_c: 'temperature', glucose_mg_dl: 'blood_glucose' }
const VITAL_COLUMNS = 'id, patient_id, encounter_id, systolic_bp, diastolic_bp, heart_rate, spo2, temperature_c, glucose_mg_dl, weight_kg, recorded_at, measurement_context, source_type'

// Convert database column names, not keys inside arbitrary clinical JSON payloads.
const rowModel = row => row == null ? null : Object.fromEntries(Object.entries(row).map(([k,v]) => [k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v]))
function patientIdRequired(id) { if (!UUID.test(id ?? '')) throw new TypeError('A valid patient ID is required.') }
async function result(query) {
  const { data, error } = await query
  if (error) {
    const failure = new Error('Unable to load patient dashboard data.')
    failure.code = error.code ?? 'DASHBOARD_QUERY_FAILED'
    throw failure
  }
  return data
}
async function allRows(makeQuery) {
  const rows = []
  for (let offset=0; ; offset+=PAGE_SIZE) {
    const page = await result(makeQuery().range(offset, offset+PAGE_SIZE-1))
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}
function localDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date)
  const part = name => parts.find(p=>p.type===name).value
  return `${part('year')}-${part('month')}-${part('day')}`
}
function validOn(row, date, start='start_date', end='end_date') {
  return (!row[start] || row[start]<=date) && (!row[end] || row[end]>=date)
}
function rangeFor(period, now) {
  let start, end
  if (typeof period === 'string' && /^(7|30|90|365)d$/.test(period)) {
    end = now; start = new Date(now.getTime()-Number(period.slice(0,-1))*86400000)
  } else if (period && typeof period==='object') {
    start = new Date(period.start); end = new Date(period.end)
  } else throw new TypeError('Period must be 7d, 30d, 90d, 365d, or { start, end }.')
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start>=end) throw new TypeError('Invalid history period.')
  return [start.toISOString(), end.toISOString()]
}

export function createPatientDashboardRepository(client, { now = () => new Date(), timeZone = 'Asia/Yangon' } = {}) {
  if (!client) throw new Error('Patient dashboard requires a configured Supabase client.')
  const scoped = (table,id,columns='*') => { patientIdRequired(id); return client.from(table).select(columns).eq('patient_id',id) }
  const medications = async id => visibleMedicationRecords(await allRows(()=>scoped('patient_medications',id,MEDICATIONS).eq('status','active').order('id')))
  const metricQuery = (id,type) => {
    let query = scoped('vital_readings',id,VITAL_COLUMNS)
    for (const column of METRICS[type]) query = query.not(column,'is',null)
    return query
  }
  async function medicationDay(id, at, activeList) {
    const rowsPromise = activeList ? Promise.resolve(activeList).then(rows => rows.map(item => ({ ...item, medication_name: item.name, dose: item.dosage, start_date: item.startDate, end_date: item.endDate, medication_schedules: (item.schedules || []).map(schedule => ({ id: schedule.id, time_of_day: schedule.timeOfDay, days_of_week: schedule.daysOfWeek, timezone: schedule.timezone, valid_from: schedule.validFrom, valid_until: schedule.validUntil })) }))) : medications(id)
    // Covers the local calendar day in every IANA offset (including DST days).
    const eventsPromise = allRows(()=>scoped('medication_events',id)
      .gte('scheduled_at',new Date(+at-48*3600000).toISOString())
      .lt('scheduled_at',new Date(+at+48*3600000).toISOString()).order('scheduled_at').order('id'))
    const [rows, events] = await Promise.all([rowsPromise, eventsPromise])
    const schedule = []
    for (const medication of rows) {
      for (const item of medication.medication_schedules ?? []) {
        const zone = item.timezone || timeZone
        const date = localDate(at,zone)
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
        if (!validOn(medication,date) || !validOn(item,date,'valid_from','valid_until') ||
          (item.days_of_week !== null && item.days_of_week !== undefined && !item.days_of_week.includes(weekday))) continue
        const matching = events.filter(e=>e.schedule_id===item.id && localDate(new Date(e.scheduled_at),zone)===date)
        schedule.push({ medication: medicationModel(medication), schedule: rowModel(item), localDate:date,
          events:matching.map(rowModel) })
      }
    }
    return { currentMedications:activeList ? rows.map(medicationModel) : rows.filter(row=>validOn(row,localDate(at,timeZone))).map(medicationModel),
      todayMedications:schedule.sort((a,b)=>a.schedule.timeOfDay.localeCompare(b.schedule.timeOfDay) || a.schedule.id.localeCompare(b.schedule.id)) }
  }
  function medicationModel(row) {
    const {medication_schedules,...fields}=row
    return {...rowModel(fields),schedules:(medication_schedules??[]).map(rowModel)}
  }
  const api = {
    async getDashboardOverview(id) {
      patientIdRequired(id)
      const [profile,healthProfile,allergies,conditions]=await Promise.all([
        result(client.from('patients').select(PROFILE).eq('id',id).maybeSingle()),
        result(scoped('patient_health_profiles',id).maybeSingle()),
        allRows(()=>scoped('patient_allergies',id,'id, allergen, reaction, severity, status').eq('status','active').order('id')),
        allRows(()=>scoped('patient_conditions',id,'id, condition_name, status').eq('status','active').order('id')),
      ])
      if (!profile) throw new Error('Patient profile unavailable.')
      return {profile:rowModel(profile),healthProfile:rowModel(healthProfile),allergies:allergies.map(rowModel),conditions:conditions.map(rowModel)}
    },
    async getPatientHealthRecordSources(id) {
      patientIdRequired(id)
      const [allergies,conditions,history]=await Promise.all([
        allRows(()=>scoped('patient_allergies',id,'id, patient_id, allergen, reaction, severity, status').eq('status','active').order('id')),
        allRows(()=>scoped('patient_conditions',id,'id, patient_id, condition_name, status').eq('status','active').order('id')),
        allRows(()=>scoped('medical_history_items',id,'id, patient_id, category, title, occurred_on, details').eq('category','vaccination').order('occurred_on',{ascending:false,nullsFirst:false}).order('id')),
      ])
      return { allergies:allergies.map(rowModel), conditions:conditions.map(rowModel), vaccinations:history.map(rowModel) }
    },
    async getDashboardProviders() {
      return (await result(client.from('providers').select('id, display_name, provider_specialties(is_primary, specialties(name))')
        .eq('provider_type','doctor').eq('verification_status','verified').order('id').limit(3))).map(row=>({
          id:row.id,displayName:row.display_name,
          specialty:(row.provider_specialties?.find(s=>s.is_primary)??row.provider_specialties?.[0])?.specialties?.name??null,
        }))
    },
    async getDashboardAppointmentProvider(id) {
      const row=await result(client.from('providers').select('id, display_name, provider_specialties(is_primary, specialties(name))').eq('id',id).maybeSingle())
      return row ? {id:row.id,displayName:row.display_name,
        specialty:(row.provider_specialties?.find(s=>s.is_primary)??row.provider_specialties?.[0])?.specialties?.name??null} : null
    },
    async getActiveCarePlans(id) {
      const at=now().toISOString()
      return (await result(scoped('subscriptions',id,'id, status, start_at, end_at, package:care_packages(name)')
        .eq('status','active').or(`start_at.is.null,start_at.lte.${at}`).or(`end_at.is.null,end_at.gt.${at}`)
        .order('created_at',{ascending:false}).limit(3))).map(rowModel)
    },
    async getLatestVitals(id) {
      return Object.fromEntries(await Promise.all(Object.keys(METRICS).map(async type => {
        const row=await result(metricQuery(id,type).lte('recorded_at',now().toISOString())
          .order('recorded_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle())
        return [type,rowModel(row)]
      })))
    },
    async getVitalHistory(id,type,period='30d') {
      type=ALIASES[type]??type
      if (!Object.hasOwn(METRICS,type)) throw new TypeError('Unsupported vital type.')
      const [start,end]=rangeFor(period,now())
      return (await allRows(()=>metricQuery(id,type).gte('recorded_at',start).lt('recorded_at',end).order('recorded_at').order('id'))).map(rowModel)
    },
    async getTodayMedications(id, activeList) { return (await medicationDay(id,now(),activeList)).todayMedications },
    async getMedicationDashboardData(id, activeList) {
      const at = now()
      const [medicationData, medicationCheckIns] = await Promise.all([
        medicationDay(id, at, activeList),
        api.getTodayMedicationCheckIns(id).catch(() => null),
      ])
      return { ...medicationData, medicationCheckIns }
    },
    async getTodayMedicationCheckIns(id) {
      const date = localDate(now(), timeZone)
      return (await allRows(() => scoped('patient_medication_check_ins', id, MEDICATION_CHECK_INS)
        .eq('local_date', date).order('patient_medication_id').order('occurrence_index'))).map(rowModel)
    },
    async recordPatientMedicationCheckIn({ medicationId, occurrenceIndex = null, requestId }) {
      patientIdRequired(medicationId)
      if (!UUID.test(requestId ?? '') || (occurrenceIndex !== null && (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 1 || occurrenceIndex > 3))) {
        throw new TypeError('A valid medication occurrence and request ID are required.')
      }
      const { data, error } = await client.rpc('record_patient_medication_check_in', {
        target_medication_id: medicationId,
        target_occurrence_index: occurrenceIndex,
        target_request_id: requestId,
      })
      if (error || !data) throw new Error('Medication check-in could not be saved.')
      return rowModel(Array.isArray(data) ? data[0] : data)
    },
    async getNextAppointment(id) {
      return rowModel(await result(scoped('appointments',id,'id, patient_id, provider_id, appointment_type, consultation_channel, scheduled_start, scheduled_end, status, reason_symptoms, booking_code')
        .in('status',['pending','confirmed']).gte('scheduled_start',now().toISOString())
        .order('scheduled_start').order('id').limit(1).maybeSingle()))
    },
    async getUpcomingAppointments(id) {
      return (await allRows(()=>scoped('appointments',id,'id, patient_id, provider_id, appointment_type, consultation_channel, scheduled_start, scheduled_end, status, reason_symptoms, booking_code')
        .in('status',['pending','confirmed']).gte('scheduled_start',now().toISOString())
        .order('scheduled_start').order('id').limit(3))).map(rowModel)
    },
    async getCarePlanConditions(id) {
      const [conditions, allergies] = await Promise.all([
        allRows(()=>scoped('patient_conditions',id,'id, patient_id, condition_name, status, diagnosed_at, onset_date').order('diagnosed_at',{ascending:false,nullsFirst:false}).order('id')),
        allRows(()=>scoped('patient_allergies',id,'id, patient_id, allergen, status, onset_date').eq('status','active').order('onset_date',{ascending:false,nullsFirst:false}).order('id')),
      ])
      return { conditions: conditions.map(rowModel), allergies: allergies.map(rowModel) }
    },
    async getActiveMedications(id) { return (await medications(id)).map(medicationModel) },
    async getActiveAlerts(id) {
      return (await allRows(()=>scoped('monitoring_alerts',id).in('status',['open','acknowledged','escalated'])
        .order('created_at',{ascending:false}).order('id'))).map(rowModel)
    },
    async getRecentHealthRecords(id) {
      const sources=[
        ['care_encounters','encounter','created_at'],
        ['clinical_documents','document','created_at'],
        ['medical_history_items','history','occurred_on','id, patient_id, category, title, occurred_on, details'],
      ]
      const records=await Promise.all(sources.map(async ([table,kind,date,columns]) =>
        (await result(scoped(table,id,columns).order(date,{ascending:false,nullsFirst:false}).order('id').limit(20)))
          .map(row=>({kind,recordedAt:row[date],record:rowModel(row)}))))
      return records.flat().sort((a,b)=>(Date.parse(b.recordedAt)||0)-(Date.parse(a.recordedAt)||0) || a.record.id.localeCompare(b.record.id)).slice(0,20)
    },
    async getRecentLabResults(id) {
      return (await result(scoped('lab_results',id).in('result_status',['preliminary','final','corrected'])
        .order('observed_at',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false}).order('id').limit(20))).map(rowModel)
    },
    async getRecentPrescriptions(id) {
      return (await result(client.from('prescriptions')
        .select('id, patient_id, status, issued_at, prescription_items(id, medication_name)')
        .eq('patient_id',id).order('issued_at',{ascending:false,nullsFirst:false}).limit(10))).map(rowModel)
    },
    async getLatestAIHealthSummary(id) {
      const at=now().toISOString()
      // A visible, current, non-future summary; never use the nonexistent health_summaries table.
      return rowModel(await result(scoped('ai_health_summaries',id).neq('review_status','hidden').is('superseded_by_id',null)
        .lte('generated_at',at).or(`expires_at.is.null,expires_at.gt.${at}`)
        .order('generated_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()))
    },
    async getPatientDashboard(id) {
      patientIdRequired(id)
      const profile=await result(client.from('patients').select(PROFILE).eq('id',id).maybeSingle())
      if (!profile) throw Object.assign(new Error('Patient profile unavailable.'),{code:'PATIENT_UNAVAILABLE'})
      const [healthProfile,latestVitals,vitalHistory,medicationData,nextAppointment,activeAlerts,recentHealthRecords,recentLabResults,latestAIHealthSummary]=await Promise.all([
        result(scoped('patient_health_profiles',id).maybeSingle()),api.getLatestVitals(id),
        allRows(()=>scoped('vital_readings',id,VITAL_COLUMNS).gte('recorded_at',new Date(+now()-30*86400000).toISOString())
          .lte('recorded_at',now().toISOString()).order('recorded_at').order('id')),
        medicationDay(id,now()),api.getNextAppointment(id),api.getActiveAlerts(id),api.getRecentHealthRecords(id),api.getRecentLabResults(id),api.getLatestAIHealthSummary(id),
      ])
      return { patientProfile:{...rowModel(profile),healthProfile:rowModel(healthProfile)},latestVitals,vitalHistory:vitalHistory.map(rowModel),
        ...medicationData,nextAppointment,activeAlerts,recentHealthRecords,recentLabResults,latestAIHealthSummary }
    },
  }
  return api
}
