import { describe, expect, it, vi } from 'vitest'
import { getAIHealthOverview } from './aiHealthOverviewService.js'

describe('overview service boundary',()=>{
  it('sends only a patient ID and receives persisted output',async()=>{
    const summary={patient_id:'p',summary_text:'Persisted',review_status:'generated',superseded_by_id:null,generated_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),recommended_actions:[]}
    const invoke=vi.fn().mockResolvedValue({data:{summary,cached:true}})
    expect((await getAIHealthOverview('p',{functions:{invoke}})).summary).toEqual(summary)
    expect(invoke).toHaveBeenCalledWith('ai-health-overview',{body:{patientId:'p'}})
  })
  it.each(['patient','expired','hidden','failed','malformed-watch-items'])('rejects %s output and returns existing safe fallback',async kind=>{
    const summary={patient_id:kind==='patient'?'other':'p',summary_text:'Do not display',review_status:kind==='hidden'?'hidden':'generated',generated_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+(kind==='expired'?-1:60000)).toISOString(),recommended_actions:[]}
    if(kind==='malformed-watch-items') summary.things_to_watch=[{message:'invalid contract'}]
    const client={functions:{invoke:async()=>kind==='failed'?{error:new Error('down')}:{data:{summary}}}}
    const result=await getAIHealthOverview('p',client)
    expect(result.summary).toBeNull()
    expect(result.fallback.sourceMode).toBe('fallback')
    expect(result.fallback.requiresHumanReview).toBe(true)
  })
})
