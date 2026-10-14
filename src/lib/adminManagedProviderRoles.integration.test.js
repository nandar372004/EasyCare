// @vitest-environment node
import { readFileSync,readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
const uid=n=>`88000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const types=['doctor','nurse','nurse_aide','skilled_nurse_aide','special_nurse','caregiver']
let db,application
beforeAll(async()=>{
  db=new PGlite({extensions:{btree_gist,pgcrypto}})
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key,encrypted_password text not null default '');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create schema storage;create function storage.foldername(name text) returns text[] language sql immutable as $$select case when strpos(name,'/')>0 then (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] else array[]::text[] end$$;create table storage.buckets(id text primary key,name text unique,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant all on storage.objects to anon,authenticated,service_role;`)
  const names=readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()
  for(const name of names.filter(n=>n<'20261009110000_admin_managed_role_values.sql'))await db.exec(readFileSync(`supabase/migrations/${name}`,'utf8'))
  for(let n=1;n<=8;n++)await db.query('insert into auth.users values($1)',[uid(n)])
  await db.query("insert into profiles(id,role,full_name) values($1,'patient','Patient'),($2,'main_admin','Admin')",[uid(1),uid(2)])
  application=(await db.query("insert into provider_applications(applicant_profile_id) values($1) returning id",[uid(1)])).rows[0].id
  for(let index=0;index<types.length;index++){
    const role=types[index]==='doctor'?'doctor':types[index]==='caregiver'?'caregiver':'nurse'
    await db.query('insert into profiles(id,role,full_name) values($1,$2,$3)',[uid(index+3),role,`Test ${types[index]}`])
    await db.query("insert into providers(profile_id,provider_type,verification_status) values($1,$2,'verified')",[uid(index+3),types[index]])
  }
  for(const name of names.filter(n=>n>='20261009110000_admin_managed_role_values.sql'))await db.exec(readFileSync(`supabase/migrations/${name}`,'utf8'))
},120000)
afterAll(async()=>db?.close())
async function as(n,action){await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid(n)]);await db.exec('set local role authenticated');return await action()}finally{await db.exec('rollback')}}
describe('admin-managed provider role foundation',()=>{
  it('fails closed on inconsistent legacy role/type instead of broadening authority',async()=>{
    await db.exec('begin')
    await db.query("update profiles set role='nurse' where id=$1",[uid(3)])
    await expect(db.exec(readFileSync('supabase/migrations/20261009111000_admin_managed_provider_role_foundation.sql','utf8'))).rejects.toThrow(/Inconsistent legacy provider/)
    await db.exec('rollback')
    expect((await db.query('select role from profiles where id=$1',[uid(3)])).rows[0].role).toBe('provider')
  })
  it('normalizes existing roles without deleting identities or historical applications',async()=>{
    expect((await db.query('select role from profiles where id=$1',[uid(2)])).rows[0].role).toBe('admin')
    expect((await db.query('select role from profiles where id=any($1::uuid[])',[types.map((_,i)=>uid(i+3))])).rows.every(r=>r.role==='provider')).toBe(true)
    expect((await db.query('select id from provider_applications where id=$1',[application])).rows).toEqual([{id:application}])
  })
  it.each(types)('resolves normalized %s through the existing provider identity',async type=>{
    await as(types.indexOf(type)+3,async()=>{
      expect((await db.query('select provider_type from get_my_provider_identity()')).rows).toEqual([{provider_type:type}])
      expect((await db.query('select clinical_identity_is_current() as allowed')).rows[0].allowed).toBe(true)
      expect((await db.query('select current_profile_role() as role')).rows[0].role).toBe(type==='doctor'?'doctor':type==='caregiver'?'caregiver':'nurse')
    })
  })
  it('rejects patient self-upgrade, provider self-admin and direct provider creation',async()=>{
    await expect(as(1,()=>db.query("update profiles set role='provider' where id=$1",[uid(1)]))).rejects.toThrow(/administratively managed/)
    await expect(as(3,()=>db.query("update profiles set role='admin' where id=$1",[uid(3)]))).rejects.toThrow(/administratively managed/)
    await expect(as(1,()=>db.query("insert into providers(profile_id,provider_type,verification_status) values($1,'doctor','verified')",[uid(1)]))).rejects.toThrow(/row-level security/)
    await as(1,async()=>expect((await db.query('select * from get_my_provider_identity()')).rows).toEqual([]))
  })
  it('retired application RPCs and credential uploads reject authenticated patients',async()=>{
    await expect(as(1,()=>db.query("select save_provider_application_draft(null,'{}')"))).rejects.toThrow(/permission denied/)
    await expect(as(1,()=>db.query('select submit_provider_application($1)',[application]))).rejects.toThrow(/permission denied/)
    await expect(as(1,()=>db.query("insert into storage.objects(bucket_id,name) values('provider-credential-evidence',$1)",[`${uid(1)}/${application}/credential.pdf`]))).rejects.toThrow(/row-level security/)
  })
  it('retains authorized admin historical review and rejects patient/provider admin calls',async()=>{
    await as(2,async()=>{expect((await db.query('select is_main_admin() as allowed')).rows[0].allowed).toBe(true);await db.query('select * from admin_list_provider_applications(null)')})
    for(const n of [1,3])await expect(as(n,()=>db.query('select * from admin_list_provider_applications(null)'))).rejects.toThrow(/Administrator access required/)
    expect((await db.query("select bool_and(relrowsecurity) as enabled from pg_class where oid in ('profiles'::regclass,'providers'::regclass,'appointments'::regclass,'provider_applications'::regclass,'storage.objects'::regclass)")).rows[0].enabled).toBe(true)
  })
  it('provisions only service-role invites with normalized provider identity and required setup state',async()=>{
    const before=(await db.query('select count(*)::int as count from providers')).rows[0].count
    await db.exec('begin')
    await db.query('insert into auth.users values($1)',[uid(9)])
    await db.exec('set local role service_role')
    try {
      const result=await db.query("select provision_invited_provider($1,$2,$3,'nurse') as id",[uid(9),'future.provider@example.test','Future Provider'])
      expect(result.rows[0].id).toBeTruthy()
      await db.exec('reset role')
      expect((await db.query('select p.role,pr.provider_type,pr.account_status,pr.setup_state,pr.verification_status from profiles p join providers pr on pr.profile_id=p.id where p.id=$1',[uid(9)])).rows[0])
        .toMatchObject({role:'provider',provider_type:'nurse',account_status:'invited',setup_state:'setup_required',verification_status:'pending'})
    } finally { await db.exec('rollback') }
    expect((await db.query('select count(*)::int as count from providers')).rows[0].count).toBe(before)
  })
  it('denies patient and provider role from provisioning and protects provider account state',async()=>{
    await expect(as(1,()=>db.query("select provision_invited_provider($1,$2,$3,'doctor')",[uid(8),'no@example.test','No']))).rejects.toThrow(/permission denied/)
    await expect(as(3,()=>db.query("select provision_invited_provider($1,$2,$3,'doctor')",[uid(8),'no@example.test','No']))).rejects.toThrow(/permission denied/)
    await expect(as(3,()=>db.query("update providers set account_status='disabled' where profile_id=$1",[uid(3)]))).rejects.toThrow(/setup state transition/)
    expect((await db.query("select count(*)::int as count from providers where account_status='invited'")).rows[0].count).toBe(0)
  })
  it('enforces invited to setup_required to profile_incomplete to ready lifecycle',async()=>{
    await db.exec('begin')
    await db.query('insert into auth.users(id,encrypted_password) values($1,$2)',[uid(9),''])
    await db.exec('set local role service_role')
    await db.query("select provision_invited_provider($1,$2,$3,'nurse')",[uid(9),'future.provider@example.test','Future Provider'])
    await db.exec('reset role;commit')
    await expect(as(9,()=>db.query('select begin_my_provider_setup()'))).rejects.toThrow(/Set a password/)
    await db.query('update auth.users set encrypted_password=$2 where id=$1',[uid(9),'hashed-password'])
    const lifecycle = await as(9, async()=>{
      const started = await db.query('select begin_my_provider_setup() as state')
      const completed = await db.query("select complete_my_provider_setup('Future Provider','09123456789',null,'Nurse') as state")
      return {started:started.rows[0].state,completed:completed.rows[0].state}
    })
    expect(lifecycle).toEqual({started:'profile_incomplete',completed:'ready'})
    const typeChange = await as(9,()=>db.query("update providers set provider_type='doctor' where profile_id=$1",[uid(9)]))
    expect(typeChange.rowCount).toBe(0)
    await expect(as(9,()=>db.query("update profiles set role='admin' where id=$1",[uid(9)]))).rejects.toThrow(/administratively managed/)
    expect((await db.query('select role from profiles where id=$1',[uid(9)])).rows[0].role).toBe('provider')
  })
  it.each(['nurse_aide','skilled_nurse_aide','special_nurse'])('provisions %s accounts behind a service-only forced password change',async providerType=>{
    await db.exec('begin')
    await db.query('insert into auth.users(id,encrypted_password) values($1,$2)',[uid(10),'initial-hash'])
    await db.exec('set local role service_role')
    const provisioned=await db.query('select provision_admin_created_provider($1,$2,$3,$4::provider_type) as id',[uid(10),`new.${providerType}@example.test`,'New Provider',providerType])
    await db.exec('reset role;commit')
    const providerId=provisioned.rows[0].id
    expect((await db.query('select p.role,pr.provider_type,pr.account_status,pr.setup_state,pr.must_change_password from profiles p join providers pr on pr.profile_id=p.id where p.id=$1',[uid(10)])).rows[0])
      .toMatchObject({role:'provider',provider_type:providerType,account_status:'active',setup_state:'setup_required',must_change_password:true})
    expect((await db.query("select table_name,column_name from information_schema.columns where table_schema='public' and table_name in ('profiles','providers') and column_name ilike '%password%' order by table_name,column_name")).rows)
      .toEqual([{table_name:'providers',column_name:'must_change_password'}])
    await expect(as(10,()=>db.query('select begin_my_provider_setup()'))).rejects.toThrow(/password setup is required/i)
    const bypass=await as(10,()=>db.query('update providers set must_change_password=false where id=$1',[providerId]))
    expect(bypass.rowCount).toBe(0)
    expect((await db.query('select must_change_password from providers where id=$1',[providerId])).rows[0].must_change_password).toBe(true)
    await db.exec('begin;set local role service_role')
    expect((await db.query('select complete_provider_initial_password_change($1) as state',[uid(10)])).rows[0].state).toBe('profile_incomplete')
    await db.exec('reset role;commit')
    await expect(as(10,()=>db.query('select begin_my_provider_setup() as state'))).resolves.toMatchObject({rows:[{state:'profile_incomplete'}]})
    const completed=await as(10,()=>db.query("select complete_my_provider_setup('New Provider','09123456789',null,'Nurse Aide') as state"))
    expect(completed.rows[0].state).toBe('ready')
    await expect(as(10,()=>db.query("select complete_provider_initial_password_change($1)",[uid(10)]))).rejects.toThrow(/permission denied/i)
    await db.query('delete from providers where id=$1',[providerId])
    await db.query('delete from profiles where id=$1',[uid(10)])
    await db.query('delete from auth.users where id=$1',[uid(10)])
  })
  it('completes Doctor setup with the supported professional fields before workspace readiness',async()=>{
    await db.exec('begin')
    await db.query('insert into auth.users(id,encrypted_password) values($1,$2)',[uid(11),'initial-hash'])
    await db.exec('set local role service_role')
    const result=await db.query("select provision_admin_created_provider($1,$2,$3,'doctor') as id",[uid(11),'new.doctor@example.test','New Doctor'])
    const providerId=result.rows[0].id
    await db.exec('reset role;commit')
    const specialty=(await db.query("select id from specialties where name='General Practitioner' limit 1")).rows[0]
    expect(specialty).toBeTruthy()
    await db.exec('begin;set local role service_role')
    await db.query(`insert into doctor_professional_information
      (provider_id,full_name,nrc,date_of_birth,work_experience_years,medical_qualification,mmc_registration_number,medical_practitioner_license_number,license_type)
      values ($1,'New Doctor','private-nrc','1980-01-01',10,'MBBS','MMC-11','SAM-11','general_medical_practitioner')`,[providerId])
    await db.exec('reset role;commit')
    await db.exec('begin;set local role service_role')
    expect((await db.query('select complete_provider_initial_password_change($1)',[uid(11)])).rowCount).toBe(1)
    await db.exec('reset role;commit')
    const completed=await as(11,async()=>{
      const state=await db.query("select complete_my_provider_setup('New Doctor','09123456780','',null,$1,null,false,false,null) as state",[specialty.id])
      const provider=await db.query('select profile_role,provider_type,setup_state,license_number,teleconsult_enabled from get_my_provider_setup_identity()')
      return {state:state.rows[0].state,provider:provider.rows[0]}
    })
    expect(completed.state).toBe('ready')
    expect(completed.provider).toMatchObject({profile_role:'provider',provider_type:'doctor',setup_state:'ready',license_number:null,teleconsult_enabled:false})
    expect((await db.query("select verification_status from providers where id=$1",[providerId])).rows[0].verification_status).toBe('pending')
    expect((await db.query("select count(*)::int as count from provider_applications where applicant_profile_id=$1",[uid(11)])).rows[0].count).toBe(0)
    await db.query('delete from provider_specialties where provider_id=$1',[providerId])
    await db.query('delete from providers where id=$1',[providerId])
    await db.query('delete from profiles where id=$1',[uid(11)])
    await db.query('delete from auth.users where id=$1',[uid(11)])
  })
  it('denies Doctor completion until private professional information exists',async()=>{
    await db.exec('begin')
    await db.query('insert into auth.users(id,encrypted_password) values($1,$2)',[uid(12),'initial-hash'])
    await db.exec('set local role service_role')
    const providerId=(await db.query("select provision_admin_created_provider($1,$2,$3,'doctor') as id",[uid(12),'missing.doctor@example.test','Missing Doctor'])).rows[0].id
    await db.exec('reset role;commit')
    await db.exec('begin;set local role service_role')
    await db.query('select complete_provider_initial_password_change($1)',[uid(12)])
    await db.exec('reset role;commit')
    const specialty=(await db.query("select id from specialties where name='General Practitioner' limit 1")).rows[0]
    await expect(as(12,()=>db.query("select complete_my_provider_setup('Missing Doctor','09123456781',null,null,$1,null,true,false,null)",[specialty.id])))
      .rejects.toMatchObject({code:'22023',message:'Doctor setup requires valid professional information and specialty'})
    expect((await db.query('select setup_state from providers where id=$1',[providerId])).rows[0].setup_state).toBe('profile_incomplete')
    await db.query('delete from providers where id=$1',[providerId])
    await db.query('delete from profiles where id=$1',[uid(12)])
    await db.query('delete from auth.users where id=$1',[uid(12)])
  })
  it('denies patient and admin identities from provider setup completion',async()=>{
    for(const n of [1,2]) await expect(as(n,()=>db.query("select complete_my_provider_setup('Other User','09123456789',null,null,null,null,false,false,null)")))
      .rejects.toMatchObject({code:'42501',message:'Provider setup is unavailable'})
  })
})
