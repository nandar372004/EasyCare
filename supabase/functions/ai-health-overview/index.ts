import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import { executeHealthOverview, OVERVIEW_PROMPT_VERSION } from '../_shared/health-overview.ts'
import { createGuardianFallback } from '../_shared/guardian-contract.ts'
import { createOpenAICompatibleAdapter } from '../_shared/guardian-provider.ts'

Deno.serve(async request=>{
  const origin=request.headers.get('origin')??''
  const allowed=(Deno.env.get('AI_ALLOWED_ORIGINS')??'http://localhost:5173,http://127.0.0.1:5173').split(',').map(v=>v.trim())
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
  if(allowed.includes(origin)) headers['Access-Control-Allow-Origin']=origin
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
  if(origin && !allowed.includes(origin)) return reply({error:'ORIGIN_DENIED'},403)
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers})
  if(request.method!=='POST') return reply({error:'METHOD_NOT_ALLOWED'},405)
  const authorization=request.headers.get('authorization')??''
  if(!authorization.startsWith('Bearer ')) return reply({error:'UNAUTHORIZED'},401)
  try {
    const url=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_ANON_KEY')!, secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const options={auth:{persistSession:false,autoRefreshToken:false}}
    const userClient=createClient(url,key,{...options,global:{headers:{Authorization:authorization}}})
    const admin=createClient(url,secret,options)
    const required=async(query:any)=>{const {data,error}=await query;if(error)throw new Error('UNAVAILABLE');return data}
    const modelName=Deno.env.get('AI_MODEL_NAME'), endpoint=Deno.env.get('AI_PROVIDER_URL'), apiKey=Deno.env.get('AI_PROVIDER_API_KEY')
    const configuredPolicy=Deno.env.get('AI_GUARDIAN_POLICY_VERSION')
    const policyVersion=configuredPolicy??'not_configured'
    const modelProvider=Deno.env.get('AI_PROVIDER_NAME')??(endpoint?new URL(endpoint).hostname:'not_configured')
    const result=await executeHealthOverview(await request.json(),{
      userClient,modelName,modelProvider,policyVersion,
      model:apiKey&&modelName&&endpoint&&configuredPolicy?createOpenAICompatibleAdapter({apiKey,modelName,endpoint}):null,
      authenticate:async()=>{
        const {data,error}=await userClient.auth.getUser(authorization.slice(7))
        if(error||!data.user)return null
        const profile=await required(userClient.from('profiles').select('role,status').eq('id',data.user.id).maybeSingle())
        return profile?{userId:data.user.id,role:profile.role,isActive:profile.status==='active'}:null
      },
      authorizePatient:async(patientId:string,userId:string)=>Boolean(await required(userClient.from('patients').select('id').eq('id',patientId).eq('profile_id',userId).maybeSingle())),
      rateLimit:async(patientId:string)=>await required(admin.rpc('consume_ai_overview_request',{p_patient_id:patientId}))===true,
      readCache:async(patientId:string,hash:string,at:string)=>await required(userClient.from('ai_health_summaries').select('*').eq('patient_id',patientId)
        .eq('prompt_version',OVERVIEW_PROMPT_VERSION).eq('source_data_hash',hash).neq('review_status','hidden').is('superseded_by_id',null)
        .lte('generated_at',at).gt('expires_at',at).order('generated_at',{ascending:false}).limit(1).maybeSingle()),
      isSuppressed:async(patientId:string,hash:string)=>Boolean(await required(admin.from('ai_health_summaries').select('id').eq('patient_id',patientId)
        .eq('source_data_hash',hash).eq('review_status','hidden').is('superseded_by_id',null).limit(1).maybeSingle())),
      claim:async(patientId:string,token:string)=>await required(admin.rpc('claim_ai_overview',{p_patient_id:patientId,p_token:token})),
      saveSummary:async(patientId:string,token:string,row:unknown)=>{
        const id=await required(admin.rpc('save_ai_overview',{p_patient_id:patientId,p_token:token,p_summary:row}))
        return await required(userClient.from('ai_health_summaries').select('*').eq('id',id).eq('patient_id',patientId).single())
      },
    })
    return reply(result)
  } catch(error) {
    const code=error instanceof Error?error.message:''
    const status=code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:code==='INVALID_REQUEST'?400:code==='RATE_LIMITED'?429:503
    return reply({error:status===503?'OVERVIEW_UNAVAILABLE':code,fallback:createGuardianFallback('AI overview is temporarily unavailable. Arrange a clinician review if needed.')},status)
  }
})
