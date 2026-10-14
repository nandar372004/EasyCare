// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createPatientDashboardRepository } from './patientDashboardRepository.js'
import { createSupabaseRepository } from './supabaseRepository.js'
import { createPatientDashboardService } from '../patientDashboardService.js'

const patient='81000000-0000-4000-8000-000000000001'
const now=new Date('2026-09-28T20:00:00Z') // Tuesday in Yangon; Monday in UTC.
function setup(respond=()=>[]) {
  const requests=[]
  const fetch=vi.fn(async (url,init)=>{
    const parsed=new URL(url); const table=parsed.pathname.split('/').at(-1)
    requests.push({table,params:parsed.searchParams,method:init.method,body:init.body})
    const response=respond(table,parsed.searchParams)
    return new Response(JSON.stringify(response.data??response),{status:response.status??200,headers:{'Content-Type':'application/json'}})
  })
  const client=createClient('https://example.supabase.co','test-browser-key',{global:{fetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  return {client,requests,repo:createPatientDashboardRepository(client,{now:()=>now})}
}
describe('patient dashboard repository using real Supabase query serialization',()=>{
  it('rejects missing clients and invalid patient identifiers',async()=>{
    expect(()=>createPatientDashboardRepository(null)).toThrow(/configured/)
    const {repo,requests}=setup()
    await expect(repo.getPatientDashboard('demo-patient')).rejects.toThrow(/valid patient/)
    await expect(repo.getActiveAlerts('')).rejects.toThrow(/valid patient/)
    expect(requests).toEqual([])
  })
  it('aggregates the real sources without synthesizing missing data',async()=>{
    const {repo,requests}=setup(table=>table==='patients'?[{id:patient,profile_id:'profile',blood_type:'A+'}]:[])
    const dashboard=await repo.getPatientDashboard(patient)
    expect(dashboard.patientProfile).toMatchObject({id:patient,bloodType:'A+',healthProfile:null})
    expect(dashboard.patientProfile).not.toHaveProperty('carePreferences')
    expect(dashboard.currentMedications).toEqual([])
    expect(dashboard.todayMedications).toEqual([])
    expect(dashboard.vitalHistory).toEqual([])
    expect(dashboard.latestVitals).toEqual({blood_pressure:null,heart_rate:null,oxygen_saturation:null,temperature:null,blood_glucose:null,weight_kg:null})
    expect(dashboard.nextAppointment).toBeNull()
    expect(dashboard.latestAIHealthSummary).toBeNull()
    for(const request of requests) {
      expect(request.method).toBe('GET')
      expect(request.params.get(request.table==='patients'?'id':'patient_id')).toBe(`eq.${patient}`)
    }
    expect(new Set(requests.map(r=>r.table))).toEqual(new Set(['patients','patient_health_profiles','vital_readings','patient_medications','medication_events','appointments','monitoring_alerts','care_encounters','clinical_documents','medical_history_items','lab_results','ai_health_summaries']))
  })
  it('stops if RLS returns no accessible patient profile',async()=>{
    const {repo,requests}=setup()
    await expect(repo.getPatientDashboard(patient)).rejects.toMatchObject({code:'PATIENT_UNAVAILABLE'})
    expect(requests).toHaveLength(1)
  })
  it('propagates database failures without returning fake clinical results or raw errors',async()=>{
    const {repo}=setup(()=>({status:403,data:{code:'42501',message:'private database details'}}))
    await expect(repo.getRecentLabResults(patient)).rejects.toMatchObject({code:'42501',message:'Unable to load patient dashboard data.'})
  })
  it('retrieves each latest metric independently using canonical columns',async()=>{
    const {repo,requests}=setup((table,params)=>params.has('heart_rate')?[{id:'pulse',heart_rate:72,recorded_at:'2026-09-28T18:00Z'}]:params.has('spo2')?[{id:'oxygen',spo2:98,recorded_at:'2026-09-27T18:00Z'}]:[])
    const latest=await repo.getLatestVitals(patient)
    expect(latest.heart_rate).toMatchObject({heartRate:72,recordedAt:'2026-09-28T18:00Z'})
    expect(latest.oxygen_saturation).toMatchObject({spo2:98,recordedAt:'2026-09-27T18:00Z'})
    expect(requests).toHaveLength(6)
    expect(requests.find(r=>r.params.has('systolic_bp')).params.get('diastolic_bp')).toBe('not.is.null')
    expect(requests.some(r=>r.params.has('temperature_c'))).toBe(true)
    expect(requests.some(r=>r.params.has('glucose_mg_dl'))).toBe(true)
    for(const {params} of requests) {
      expect(params.get('recorded_at')).toBe(`lte.${now.toISOString()}`)
      expect(params.get('limit')).toBe('1')
      expect(params.get('order')).toBe('recorded_at.desc,id.desc')
    }
  })
  it('paginates ordered history and uses half-open time boundaries',async()=>{
    const {repo,requests}=setup((table,params)=>Number(params.get('offset')??0)===0?Array.from({length:500},(_,i)=>({id:String(i),temperature_c:36.5})):[{id:'500',temperature_c:37}])
    const history=await repo.getVitalHistory(patient,'temperature','7d')
    expect(history).toHaveLength(501)
    expect(history.at(-1).temperatureC).toBe(37)
    expect(requests[0].params.getAll('recorded_at')).toEqual(['gte.2026-09-21T20:00:00.000Z','lt.2026-09-28T20:00:00.000Z'])
    expect(requests[1].params.get('offset')).toBe('500')
    expect(requests[0].params.get('temperature_c')).toBe('not.is.null')
  })
  it('accepts explicit history ranges and rejects unrecognized types or invalid periods',async()=>{
    const {repo,requests}=setup()
    await repo.getVitalHistory(patient,'spo2',{start:'2026-09-01',end:'2026-09-02'})
    expect(requests[0].params.get('spo2')).toBe('not.is.null')
    await expect(repo.getVitalHistory(patient,'random','7d')).rejects.toThrow(/Unsupported/)
    await expect(repo.getVitalHistory(patient,'heart_rate','forever')).rejects.toThrow(/Period/)
    await expect(repo.getVitalHistory(patient,'heart_rate',{start:'invalid',end:'invalid'})).rejects.toThrow(/Invalid/)
  })
  it('builds timezone-aware schedules, keeps actual statuses, and invents no events',async()=>{
    const schedule={patient_medication_id:'med',time_of_day:'08:00:00',days_of_week:[2],timezone:'Asia/Yangon',valid_from:'2026-09-29',valid_until:'2026-09-29'}
    const medication={id:'med',patient_id:patient,status:'active',start_date:'2026-09-29',end_date:null,medication_name:'Recorded medicine',medication_schedules:[
      {...schedule,id:'taken'}, {...schedule,id:'skipped'}, {...schedule,id:'unrecorded'},
      {...schedule,id:'wrong-day',days_of_week:[1]}, {...schedule,id:'expired',valid_until:'2026-09-28'},
      {...schedule,id:'utc-day',timezone:'UTC'}, {...schedule,id:'disabled-days',days_of_week:[]},
    ]}
    const events=[{id:'e1',schedule_id:'taken',status:'taken',scheduled_at:'2026-09-29T01:30Z'},
      {id:'e2',schedule_id:'skipped',status:'skipped',scheduled_at:'2026-09-29T01:30Z'},
      {id:'yesterday',schedule_id:'taken',status:'missed',scheduled_at:'2026-09-28T01:30Z'}]
    const {repo,requests}=setup(table=>table==='patient_medications'?[medication]:events)
    const today=await repo.getTodayMedications(patient)
    expect(today.map(item=>item.schedule.id)).toEqual(['skipped','taken','unrecorded'])
    expect(today[0].events[0].status).toBe('skipped')
    expect(today[1].events.map(e=>e.status)).toEqual(['taken'])
    expect(today[2].events).toEqual([])
    expect(today.every(item=>item.localDate==='2026-09-29')).toBe(true)
    expect(requests[0].params.get('status')).toBe('eq.active')
    expect(requests[0].params.get('select')).toBe('id,patient_id,medication_name,dose,frequency,instructions,start_date,end_date,status,medication_schedules(id,time_of_day,days_of_week,timezone,valid_from,valid_until)')
    for(const unsupported of ['prescribing_provider_id','reason_for_medication','discontinued_at','discontinued_reason','patient_medication_id']) {
      expect(requests[0].params.get('select')).not.toContain(unsupported)
    }
  })
  it('reads only the authenticated patient check-ins for the current Yangon date and writes through the owned RPC',async()=>{
    const checkin={id:'checkin',patient_medication_id:'med',patient_id:patient,local_date:'2026-09-29',occurrence_index:1,is_prn:false,status:'taken',completed_at:'2026-09-29T02:00:00Z',request_id:'81000000-0000-4000-8000-000000000002',created_at:'2026-09-29T02:00:00Z'}
    const {repo,requests}=setup(table=>table==='patient_medication_check_ins'?{data:[checkin]}:table==='record_patient_medication_check_in'?{data:checkin}:[])
    expect(await repo.getTodayMedicationCheckIns(patient)).toMatchObject([{patientMedicationId:'med',patientId:patient,localDate:'2026-09-29',occurrenceIndex:1,isPrn:false,status:'taken'}])
    expect(requests[0].table).toBe('patient_medication_check_ins')
    expect(requests[0].params.get('patient_id')).toBe(`eq.${patient}`)
    expect(requests[0].params.get('local_date')).toBe('eq.2026-09-29')
    const result=await repo.recordPatientMedicationCheckIn({medicationId:'81000000-0000-4000-8000-000000000003',occurrenceIndex:2,requestId:checkin.request_id})
    expect(result).toMatchObject({patientMedicationId:'med',occurrenceIndex:1,status:'taken'})
    expect(requests[1].method).toBe('POST')
    expect(requests[1].table).toBe('record_patient_medication_check_in')
    expect(JSON.parse(requests[1].body)).toMatchObject({target_medication_id:'81000000-0000-4000-8000-000000000003',target_occurrence_index:2,target_request_id:checkin.request_id})
  })
  it('keeps current medications without a schedule and excludes future/expired courses',async()=>{
    const rows=[{id:'current',start_date:null,end_date:null},{id:'future',start_date:'2026-10-01'},{id:'expired',end_date:'2026-09-28'}]
    const {repo}=setup(table=>table==='patients'?[{id:patient}]:table==='patient_medications'?rows:[])
    const dashboard=await repo.getPatientDashboard(patient)
    expect(dashboard.currentMedications.map(r=>r.id)).toEqual(['current'])
    expect(dashboard.todayMedications).toEqual([])
  })
  it('queries only future active appointments with chronological ordering',async()=>{
    const {repo,requests}=setup(()=>[{id:'appointment',scheduled_start:'2026-09-30T09:00Z'}])
    expect(await repo.getNextAppointment(patient)).toMatchObject({scheduledStart:'2026-09-30T09:00Z'})
    expect(requests[0].params.get('status')).toBe('in.(pending,confirmed)')
    expect(requests[0].params.get('scheduled_start')).toBe(`gte.${now.toISOString()}`)
    expect(requests[0].params.get('order')).toBe('scheduled_start.asc,id.asc')
  })
  it('keeps health alerts separate from notifications and excludes resolved status',async()=>{
    const {repo,requests}=setup(()=>[])
    await repo.getActiveAlerts(patient)
    expect(requests[0].table).toBe('monitoring_alerts')
    expect(requests[0].params.get('status')).toBe('in.(open,acknowledged,escalated)')
  })
  it('merges real encounters, documents and history in descending date order',async()=>{
    const {repo,requests}=setup(table=>table==='clinical_documents'?[{id:'doc',created_at:'2026-09-28',storage_path:'private/path'}]:table==='care_encounters'?[{id:'encounter',created_at:'2026-09-27'}]:[{id:'history',occurred_on:'2026-09-01'}])
    expect((await repo.getRecentHealthRecords(patient)).map(r=>r.kind)).toEqual(['document','encounter','history'])
    expect(requests.find(r=>r.table==='medical_history_items').params.get('select')).toBe('id,patient_id,category,title,occurred_on,details')
  })
  it('excludes cancelled/pending lab results and preserves preliminary labels',async()=>{
    const {repo,requests}=setup(()=>[{id:'result',result_status:'preliminary',value_numeric:4}])
    expect((await repo.getRecentLabResults(patient))[0]).toMatchObject({resultStatus:'preliminary',valueNumeric:4})
    expect(requests[0].params.get('result_status')).toBe('in.(preliminary,final,corrected)')
  })
  it('filters hidden, expired, superseded and future AI summaries without changing JSON provenance',async()=>{
    const {repo,requests}=setup(()=>[{id:'summary',source_snapshot:{patient_id:patient},summary_text:'Derived'}])
    expect(await repo.getLatestAIHealthSummary(patient)).toMatchObject({sourceSnapshot:{patient_id:patient},summaryText:'Derived'})
    const params=requests[0].params
    expect(requests[0].table).toBe('ai_health_summaries')
    expect(params.get('review_status')).toBe('neq.hidden')
    expect(params.get('superseded_by_id')).toBe('is.null')
    expect(params.get('generated_at')).toBe(`lte.${now.toISOString()}`)
    expect(params.get('or')).toBe(`(expires_at.is.null,expires_at.gt.${now.toISOString()})`)
  })
  it('exposes dashboard methods through the existing Supabase repository and fixes its summary table',async()=>{
    const {client,requests}=setup()
    const repo=createSupabaseRepository(client)
    expect(typeof repo.getPatientDashboard).toBe('function')
    expect(await repo.getHealthSummary(patient)).toBeNull()
    expect(requests[0].table).toBe('ai_health_summaries')
  })
  it('service delegates using the supplied repository',async()=>{
    const getVitalHistory=vi.fn().mockResolvedValue([])
    const service=createPatientDashboardService({getVitalHistory})
    await service.getVitalHistory(patient,'heart_rate','7d')
    expect(getVitalHistory).toHaveBeenCalledWith(patient,'heart_rate','7d')
  })
  it('loads actual overview conditions and allergies with patient and active filters',async()=>{
    const {repo,requests}=setup(table=>table==='patients'?[{id:patient,blood_type:'B-'}]:table==='patient_allergies'?[{id:'allergy',allergen:'Recorded allergen'}]:table==='patient_conditions'?[{id:'condition',condition_name:'Recorded condition'}]:[])
    expect(await repo.getDashboardOverview(patient)).toMatchObject({profile:{bloodType:'B-'},allergies:[{allergen:'Recorded allergen'}],conditions:[{conditionName:'Recorded condition'}]})
    for(const table of ['patient_allergies','patient_conditions']) {
      const params=requests.find(r=>r.table===table).params
      expect(params.get('patient_id')).toBe(`eq.${patient}`)
      expect(params.get('status')).toBe('eq.active')
    }
  })
  it('does not fabricate missing directory specialties',async()=>{
    const {repo}=setup(()=>[{id:'provider',display_name:'Recorded Doctor',provider_specialties:[]}])
    expect((await repo.getDashboardProviders())[0]).toMatchObject({displayName:'Recorded Doctor',specialty:null})
    expect(await repo.getDashboardAppointmentProvider('provider')).toMatchObject({specialty:null})
  })
  it('scopes active subscriptions and applies both validity boundaries',async()=>{
    const {repo,requests}=setup(()=>[])
    await repo.getActiveCarePlans(patient)
    const params=requests[0].params
    expect(params.get('patient_id')).toBe(`eq.${patient}`)
    expect(params.get('status')).toBe('eq.active')
    expect(params.getAll('or')).toEqual([`(start_at.is.null,start_at.lte.${now.toISOString()})`,`(end_at.is.null,end_at.gt.${now.toISOString()})`])
  })
})

it('enriches the Medications tab active list without another medication-table read', async () => {
  const { repo, requests } = setup(table => table === 'patient_medication_check_ins' ? [{ patient_medication_id: 'clinical', occurrence_index: 2, is_prn: false, status: 'taken' }] : [])
  const active = [{ id: 'clinical', name: 'Actual clinical record', dosage: '1 tablet', frequency: 'twice daily', status: 'active', source: 'Existing origin', endDate: '2026-09-01', schedules: [{ id: 's', timeOfDay: '08:30', timezone: 'Asia/Yangon', daysOfWeek: [2] }] }, { id: 'reported:r', name: 'Actual reported record', dosage: '1 capsule', frequency: 'as needed', status: 'active', source: 'Patient-reported', isPatientReported: true }]
  const data = await repo.getMedicationDashboardData(patient, active)
  expect(data.currentMedications.map(row => row.medicationName)).toEqual(active.map(row => row.name))
  expect(data.currentMedications[1]).toMatchObject({ id: 'reported:r', source: 'Patient-reported', isPatientReported: true })
  expect(data.medicationCheckIns[0]).toMatchObject({ patientMedicationId: 'clinical', occurrenceIndex: 2, status: 'taken' })
  expect(requests.some(request => request.table === 'patient_medications')).toBe(false)
  expect(requests.every(request => request.method === 'GET')).toBe(true)
})
