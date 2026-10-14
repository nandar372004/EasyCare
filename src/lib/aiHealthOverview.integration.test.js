// @vitest-environment node
// Actual migration chain in isolated PostgreSQL/WASM; managed Auth and Storage schemas are simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { executeHealthOverview } from '../../supabase/functions/_shared/health-overview.ts'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20260929170000_ai_overview_cache.sql'
const uid = (n) => `82000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('AI health overview pipeline', () => {
  let db, patients, providers, encounters, summaries, summariesBefore, conditionsBefore, patientsBefore, encountersBefore, policiesBefore

  async function actor(n, role = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [n ? uid(n) : ''])
    await db.exec(`set local role ${role}`)
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { btree_gist, pgcrypto } })
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    `)
    await db.exec(`
      create schema storage;
      create table storage.buckets(id text primary key, public boolean not null default false);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, unique(bucket_id, name));
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
      grant all on storage.objects to anon, authenticated, service_role;
      -- Deliberately broad legacy policies: restrictive guards must still protect clinical files.
      create policy legacy_all on storage.objects for all to anon, authenticated using (true) with check (true);
    `)
    for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql') && name < migrationName).sort()) {
      await db.exec(readFileSync(join(directory, name), 'utf8'))
    }
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])
    patients = []
    for (const n of [1, 2]) {
      patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
        userId: uid(n), fullName: 'Synthetic Lab Patient', phone: `+95975000000${n}`, dateOfBirth: '1990-01-01', medicalProfile: {},
      })])).rows[0].id)
    }
    providers = {}
    for (const [n, role] of [[3, 'doctor'], [4, 'nurse'], [5, 'doctor'], [6, 'family'], [7, 'main_admin']]) {
      await db.query('insert into public.profiles(id, role, full_name) values ($1, $2, $3)', [uid(n), role, `Synthetic ${role}`])
      if (n <= 5) providers[n] = (await db.query("insert into public.providers(profile_id, provider_type, verification_status) values ($1, $2, 'verified') returning id", [uid(n), role])).rows[0].id
    }
    encounters = []
    for (const i of [0, 1]) {
      const appointment = (await db.query(`insert into public.appointments(patient_id, provider_id, appointment_type,
        scheduled_start, scheduled_end, consultation_channel, booking_code)
        values ($1, $2, 'teleconsultation', $3, $4, 'video', $5) returning id`,
      [patients[i], providers[i === 0 ? 3 : 5], `2026-09-${20 + i}T09:00Z`, `2026-09-${20 + i}T09:30Z`, `ECA-LAB-${i}`])).rows[0].id
      encounters.push((await db.query("insert into public.care_encounters(appointment_id, patient_id, provider_id, encounter_type) values ($1, $2, $3, 'teleconsultation') returning id", [appointment, patients[i], providers[i === 0 ? 3 : 5]])).rows[0].id)
    }
    const request = (await db.query("insert into public.care_requests(patient_id, requested_by_profile_id, service_type, reason_symptoms) values ($1, $2, 'teleconsultation', 'Synthetic') returning id", [patients[0], uid(1)])).rows[0].id
    await db.query("insert into public.care_assignments(care_request_id, provider_id, assigned_by_profile_id, status) values ($1, $2, $3, 'accepted')", [request, providers[4], uid(3)])
    await db.query("insert into public.family_authorizations(patient_id, family_profile_id, status, can_view_records) values ($1, $2, 'active', true)", [patients[0], uid(6)])
    patientsBefore = (await db.query('select * from public.patients order by id')).rows
    encountersBefore = (await db.query('select * from public.care_encounters order by id')).rows
    policiesBefore = (await db.query("select * from pg_policies where schemaname = 'public' order by tablename, policyname")).rows
    await db.query("insert into public.vital_readings(patient_id,source,recorded_at,heart_rate) values ($1,'manual','2026-09-27',72),($1,'manual','2026-09-28',74),($2,'manual','2026-09-28',99)",[patients[0],patients[1]])
    await db.query("insert into public.patient_conditions(patient_id,condition_name,status) values ($1,'Recorded condition','active')",[patients[0]])
    await db.query("insert into public.patient_allergies(patient_id,allergen) values ($1,'Recorded allergen')",[patients[0]])
    const med=(await db.query("insert into public.patient_medications(patient_id,medication_name,status) values ($1,'Recorded medicine','active') returning id",[patients[0]])).rows[0].id
    const schedule=(await db.query("insert into public.medication_schedules(patient_medication_id,time_of_day) values ($1,'08:00') returning id",[med])).rows[0].id
    await db.query("insert into public.medication_events(patient_id,schedule_id,scheduled_at,status) values ($1,$2,'2026-09-28','taken')",[patients[0],schedule])
    const order=(await db.query('insert into public.lab_orders(patient_id,ordered_by_provider_id) values ($1,$2) returning id',[patients[0],providers[3]])).rows[0].id
    await db.query("insert into public.lab_results(lab_order_id,patient_id,test_name,value_text,result_status,observed_at,verified_at) values ($1,$2,'Recorded test','Recorded result','final','2026-09-28','2026-09-28')",[order,patients[0]])
    await db.exec("update public.lab_results set created_at='2026-09-28'; update public.care_encounters set created_at='2026-09-28'")
    await db.query("insert into public.appointments(patient_id,provider_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code) values ($1,$2,'teleconsultation','2026-09-30T09:00Z','2026-09-30T09:30Z','video','OVERVIEW-NEXT')",[patients[0],providers[3]])
    await db.exec(readFileSync(join(directory,migrationName),'utf8'))
  },60000)
  beforeEach(async()=>{await db.exec('begin');await actor(1)})
  afterEach(async()=>{await db.exec('rollback')})
  afterAll(async()=>{await db?.close()})

  // Execute the builder's real SELECTs with actual RLS, not canned record data.
  function userClient() {
    return {from(table){
      let columns='*',wheres=[],orders=[],limit=501,single=false,params=[]
      const param=value=>{params.push(value);return `$${params.length}`}
      const q={select(value){columns=value;return q},eq(k,v){wheres.push(`${k}=${param(v)}`);return q},
        gte(k,v){wheres.push(`${k}>=${param(v)}`);return q},lte(k,v){wheres.push(`${k}<=${param(v)}`);return q},
        in(k,values){wheres.push(`${k} in (${values.map(param).join(',')})`);return q},
        not(k){wheres.push(`${k} is not null`);return q},
        or(value){wheres.push('('+value.split(',').map(term=>{const [,key,op,val]=term.match(/^([^.]+)\.(is|lte|gte)\.(.*)$/);return op==='is'?`${key} is null`:`${key}${op==='lte'?'<=':'>='}${param(val)}`}).join(' or ')+')');return q},
        order(k,opts={}){orders.push(`${k} ${opts.ascending===false?'desc':'asc'} nulls last`);return q},
        limit(v){limit=v;return q},maybeSingle(){single=true;return q},
        then(resolve,reject){return db.query(`select ${columns} from public.${table} ${wheres.length?'where '+wheres.join(' and '):''} ${orders.length?'order by '+orders.join(','):''} limit ${limit}`,params)
          .then(r=>resolve({data:single?(r.rows[0]??null):r.rows,error:null}),reject)},
      };return q
    }}
  }
  const modelResponse={riskLevel:'soon',summary:'Recorded information is available for clinician review.',guidance:['Discuss these records with your care team.'],recommendedSpecialty:null,redFlags:[],disclaimerKey:'guardian.general_not_diagnosis',actions:['book_appointment'],sourceMode:'model',requiresHumanReview:true}
  async function server(work){await db.exec('set local role service_role');try{return await work()}finally{await actor(1)}}
  function dependencies(overrides={}) {
    return {userClient:userClient(),now:()=>new Date('2026-09-29T12:00Z'),modelName:'test-model',modelProvider:'test-provider',policyVersion:'test-policy',
      authenticate:async()=>({userId:uid(1),role:'patient',isActive:true}),
      authorizePatient:async(id,user)=>(await db.query('select id from public.patients where id=$1 and profile_id=$2',[id,user])).rows.length===1,
      rateLimit:async(id)=>server(async()=>(await db.query('select public.consume_ai_overview_request($1) as accepted',[id])).rows[0].accepted),
      readCache:async(id,hash,at)=>(await db.query("select * from public.ai_health_summaries where patient_id=$1 and source_data_hash=$2 and expires_at>$3 and generated_at<=$3 and superseded_by_id is null and review_status<>'hidden'",[id,hash,at])).rows[0]??null,
      claim:async(id,token)=>server(async()=>(await db.query('select public.claim_ai_overview($1,$2) as claimed',[id,token])).rows[0].claimed),
      saveSummary:async(id,token,row)=>{const saved=await server(async()=>(await db.query('select public.save_ai_overview($1,$2,$3::jsonb) as id',[id,token,JSON.stringify(row)])).rows[0].id);return (await db.query('select * from public.ai_health_summaries where id=$1',[saved])).rows[0]},
      model:{generate:async()=>modelResponse},...overrides}
  }
  it('runs authorized context → safety → gateway → validation → persisted derived summary',async()=>{
    const before=(await db.query('select * from public.patient_conditions')).rows
    let prompt
    const output=await executeHealthOverview({patientId:patients[0]},dependencies({model:{generate:async request=>{prompt=request;return modelResponse}}}))
    expect(output.summary).toMatchObject({patient_id:patients[0],overall_status:'model',model_name:'test-model',review_status:'generated'})
    const context=output.summary.source_snapshot.context
    expect(context.latestVitals.heart_rate.heart_rate).toBe(74)
    expect(context.vitalTrends.heart_rate.delta).toBe(2)
    for(const source of Object.values(context.sources)) for(const row of source.rows) expect(row.patient_id).toBe(patients[0])
    expect(context.sources.medications.rows).toHaveLength(1)
    expect(context.sources.medicationEvents.rows).toHaveLength(1)
    expect(context.sources.labs.rows).toHaveLength(1)
    expect(context.sources.encounters.rows).toHaveLength(1)
    expect(context.upcomingAppointment.patient_id).toBe(patients[0])
    expect(context.medicationScheduleLinks.rows).toHaveLength(1)
    expect(output.summary.source_data_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(prompt.systemPrompt).toContain('Never infer or diagnose')
    expect(prompt.userContent).not.toContain(patients[0])
    expect((await db.query('select * from public.patient_conditions')).rows).toEqual(before)
  })
  it('reuses the persisted cache on refresh without a second model call',async()=>{
    let calls=0;const deps=dependencies({model:{generate:async()=>{calls++;return modelResponse}}})
    const first=await executeHealthOverview({patientId:patients[0]},deps)
    const second=await executeHealthOverview({patientId:patients[0]},deps)
    expect(calls).toBe(1);expect(second.cached).toBe(true);expect(second.summary.id).toBe(first.summary.id)
  })
  it('supersedes after a source change and cooldown, retaining provenance',async()=>{
    const first=await executeHealthOverview({patientId:patients[0]},dependencies())
    await server(async()=>{
      await db.query("insert into public.vital_readings(patient_id,source,recorded_at,heart_rate) values ($1,'manual','2026-09-29T10:00Z',76)",[patients[0]])
      await db.exec("update public.ai_overview_leases set retry_after='2000-01-01',lease_until='2000-01-01'")
    })
    const next=await executeHealthOverview({patientId:patients[0]},dependencies())
    expect(next.summary.source_data_hash).not.toBe(first.summary.source_data_hash)
    expect((await db.query('select superseded_by_id from public.ai_health_summaries where id=$1',[first.summary.id])).rows[0].superseded_by_id).toBe(next.summary.id)
  })
  it('rejects another patient before reading context or calling AI',async()=>{
    let calls=0
    await expect(executeHealthOverview({patientId:patients[1]},dependencies({model:{generate:async()=>{calls++;return modelResponse}}}))).rejects.toThrow('FORBIDDEN')
    expect(calls).toBe(0)
  })
  it('rejects browser-supplied clinical context',async()=>{
    await expect(executeHealthOverview({patientId:patients[0],context:{diagnosis:'invented'}},dependencies())).rejects.toThrow('INVALID_REQUEST')
  })
  it.each(['unauthenticated','inactive','rate-limit'])('blocks %s requests',async kind=>{
    const extra=kind==='rate-limit'?{rateLimit:async()=>false}:{authenticate:async()=>kind==='unauthenticated'?null:{userId:uid(1),role:'patient',isActive:false}}
    await expect(executeHealthOverview({patientId:patients[0]},dependencies(extra))).rejects.toThrow()
  })
  it.each(['diagnosis','invalid','timeout','unavailable'])('uses and caches existing safe fallback for %s',async kind=>{
    const model=kind==='unavailable'?null:{generate:async()=>kind==='timeout'?new Promise(()=>{}):kind==='invalid'?{bad:true}:{...modelResponse,summary:'You have influenza.'}}
    const output=await executeHealthOverview({patientId:patients[0]},dependencies({model,timeoutMs:5}))
    expect(output.summary.overall_status).toBe('fallback')
    expect(output.summary.model_name).toBe(kind==='unavailable'?'not_called':'test-model')
    expect(output.summary.summary_text).not.toContain('influenza')
    expect(output.summary.recommended_actions[0]).toContain('clinician')
  })
  it('applies deterministic critical-record safety before AI',async()=>{
    await server(()=>db.query("insert into public.monitoring_alerts(patient_id,alert_type,severity,message) values ($1,'recorded','critical','Existing critical flag')",[patients[0]]))
    let calls=0
    const output=await executeHealthOverview({patientId:patients[0]},dependencies({model:{generate:async()=>{calls++;return modelResponse}}}))
    expect(calls).toBe(0);expect(output.summary.overall_status).toBe('fallback')
  })
  it('prevents duplicate workers, stale token saves, and browser RPC writes',async()=>{
    const token=uid(90)
    expect(await server(async()=>(await db.query('select public.claim_ai_overview($1,$2) as claimed',[patients[0],token])).rows[0].claimed)).toBe(true)
    const result=await executeHealthOverview({patientId:patients[0]},dependencies())
    expect(result.state).toBe('pending')
    await db.exec('savepoint denied')
    await expect(db.query('select public.claim_ai_overview($1,$2)',[patients[0],uid(91)])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied; set local role service_role')
    await expect(db.query("select public.save_ai_overview($1,$2,'{}'::jsonb)",[patients[0],uid(91)])).rejects.toMatchObject({code:'42501'})
  })
  it('does not regenerate a review-hidden fingerprint',async()=>{
    const result=await executeHealthOverview({patientId:patients[0]},dependencies({isSuppressed:async()=>true}))
    expect(result.state).toBe('hidden')
    expect((await db.query('select id from public.ai_health_summaries')).rows).toEqual([])
  })
  it('refreshes an expired summary while preserving history',async()=>{
    const first=await executeHealthOverview({patientId:patients[0]},dependencies())
    await server(()=>db.exec("update public.ai_overview_leases set retry_after='2000-01-01',lease_until='2000-01-01'"))
    const next=await executeHealthOverview({patientId:patients[0]},dependencies({now:()=>new Date('2026-09-29T20:00Z')}))
    expect(next.cached).toBe(false)
    expect(next.summary.id).not.toBe(first.summary.id)
  })
  it('does not call AI or store misleading provenance after a source read failure',async()=>{
    let called=false
    const failClient={from(){return {select(){throw new Error('READ_FAILED')}}}}
    await expect(executeHealthOverview({patientId:patients[0]},dependencies({userClient:failClient,model:{generate:async()=>{called=true;return modelResponse}}}))).rejects.toThrow('READ_FAILED')
    expect(called).toBe(false)
    expect((await db.query('select id from public.ai_health_summaries')).rows).toEqual([])
  })
  it('keeps persisted summaries isolated from another patient through RLS',async()=>{
    await executeHealthOverview({patientId:patients[0]},dependencies())
    await actor(2)
    expect((await db.query('select id from public.ai_health_summaries')).rows).toEqual([])
  })
  it('enforces the database request budget and resets expired windows',async()=>{
    await server(async()=>{
      const results=(await db.query('select public.consume_ai_overview_request($1) as accepted from generate_series(1,61)',[patients[0]])).rows
      expect(results.filter(r=>r.accepted)).toHaveLength(60)
      expect(results[60].accepted).toBe(false)
      await db.exec("update public.ai_overview_request_limits set window_start=now()-interval '16 minutes'")
      expect((await db.query('select public.consume_ai_overview_request($1) as accepted',[patients[0]])).rows[0].accepted).toBe(true)
    })
    await expect(db.query('select public.consume_ai_overview_request($1)',[patients[0]])).rejects.toMatchObject({code:'42501'})
  })
})
