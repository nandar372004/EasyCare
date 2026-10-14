import { supabase } from '../lib/supabase.js'
import { createSafeFallback } from '../features/guardian/guardianSafety.js'

export async function getAIHealthOverview(patientId, client=supabase) {
  const unavailable=()=>({summary:null,fallback:createSafeFallback('AI overview is temporarily unavailable. Arrange a clinician review if needed.')})
  if(!client || !patientId) return unavailable()
  try {
    const {data,error}=await client.functions.invoke('ai-health-overview',{body:{patientId}})
    if(error || !data) return unavailable()
    const row=data.summary
    if(row && (row.patient_id!==patientId || row.review_status==='hidden' || row.superseded_by_id ||
      !Number.isFinite(Date.parse(row.generated_at)) || Date.parse(row.generated_at)>Date.now() ||
      !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at)<=Date.now() ||
      typeof row.summary_text!=='string' || !Array.isArray(row.recommended_actions) || row.recommended_actions.some(item=>typeof item!=='string') ||
      (row.things_to_watch != null && (!Array.isArray(row.things_to_watch) || row.things_to_watch.some(item=>typeof item!=='string'))))) return unavailable()
    return row?{summary:row,cached:data.cached}:{summary:null,fallback:createSafeFallback(data.state==='pending'?'An overview is being prepared. Please try again later.':'AI overview is unavailable. Contact your care team.')}
  } catch {return unavailable()}
}
