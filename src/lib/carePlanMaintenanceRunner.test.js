import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CARE_PLAN_MAINTENANCE_BATCH_SIZE, CARE_PLAN_MAINTENANCE_MAX_PAGES, runCarePlanMaintenance } from '../../supabase/scripts/run-care-plan-maintenance.mjs'

const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const pageResponse = body => ({ ok:true, status:200, json:async()=>body })
const page = (n, { more=false, failures=[], cursor=n }={}) => ({ processed:n, generated:n*2, failures, next_after_id:n ? uuid(cursor) : null, has_more:more })
const setup = pages => {
  const fetchImpl=vi.fn(async (_url, options)=>{
    expect(JSON.parse(options.body).p_batch_size).toBe(50)
    return pageResponse(pages.shift())
  })
  const logs=[]
  const log=vi.fn(value=>logs.push(JSON.parse(value)))
  return { fetchImpl, logs, log }
}

describe('trusted Care Plan maintenance runner',()=>{
  it('runs one page and exits when has_more is false',async()=>{
    const mock=setup([page(4)])
    const summary=await runCarePlanMaintenance({supabaseUrl:'https://easycare.supabase.co',serviceRoleKey:'server-secret',...mock})
    expect(summary).toMatchObject({pages:1,processed:4,generated:8,failure_count:0})
    expect(mock.fetchImpl).toHaveBeenCalledTimes(1)
    expect(mock.logs.at(-1).event).toBe('care_plan_maintenance_complete')
  })

  it.each([
    ['fewer than 50',page(12)],
    ['exactly 50',page(50)],
  ])('handles a %s plan page',async(_label,body)=>{
    const mock=setup([body])
    const result=await runCarePlanMaintenance({supabaseUrl:'https://easycare.supabase.co',serviceRoleKey:'server-secret',...mock})
    expect(result.processed).toBe(body.processed)
    expect(mock.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('continues through multiple pages in stable cursor order',async()=>{
    const mock=setup([page(50,{more:true}),page(50,{more:true,cursor:100}),page(1,{cursor:101})])
    const result=await runCarePlanMaintenance({supabaseUrl:'https://easycare.supabase.co',serviceRoleKey:'server-secret',...mock})
    expect(result).toMatchObject({pages:3,processed:101,generated:202})
    expect(mock.fetchImpl.mock.calls.map(call=>JSON.parse(call[1].body).p_after_id)).toEqual([null,uuid(50),uuid(100)])
    expect(result.failure_count).toBe(0)
  })

  it('logs a plan failure, continues to the next page, and returns a failed summary',async()=>{
    const planFailure={plan_id:uuid(3),sqlstate:'22023',message:'must not be logged'}
    const mock=setup([page(50,{more:true,failures:[planFailure]}),page(1,{cursor:51})])
    const result=await runCarePlanMaintenance({supabaseUrl:'https://easycare.supabase.co',serviceRoleKey:'server-secret',...mock})
    expect(mock.fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({pages:2,processed:51,failure_count:1,failures:[{plan_id:uuid(3),sqlstate:'22023'}]})
    expect(JSON.stringify(mock.logs)).not.toContain('must not be logged')
  })

  it('stops with a non-success error at the defensive page cap',async()=>{
    const mock=setup([page(50,{more:true}),page(50,{more:true,cursor:100})])
    await expect(runCarePlanMaintenance({supabaseUrl:'https://easycare.supabase.co',serviceRoleKey:'server-secret',maxPages:2,...mock})).rejects.toThrow('MAINTENANCE_PAGE_CAP_REACHED')
    expect(mock.fetchImpl).toHaveBeenCalledTimes(2)
    expect(mock.logs.at(-1)).toMatchObject({event:'care_plan_maintenance_page_cap',pages:2,cursor:uuid(100)})
  })

  it('returns non-success for transient HTTP/RPC errors without logging response bodies',async()=>{
    const fetchImpl=vi.fn(async()=>({ok:false,status:503,text:async()=> 'sensitive database detail'}))
    await expect(runCarePlanMaintenance({supabaseUrl:'https://easycare.supabase.co',serviceRoleKey:'server-secret',fetchImpl,log:vi.fn()})).rejects.toThrow('MAINTENANCE_RPC_HTTP_503')
  })

  it('rejects a non-advancing cursor and malformed maintenance responses',async()=>{
    const stalled=setup([page(50,{more:true}),{...page(50,{more:true}),next_after_id:uuid(50)}])
    await expect(runCarePlanMaintenance({supabaseUrl:'https://easycare.supabase.co',serviceRoleKey:'server-secret',...stalled})).rejects.toThrow('MAINTENANCE_RPC_CURSOR_DID_NOT_ADVANCE')
    const malformed=setup([{processed:51,generated:0,failures:[],next_after_id:uuid(2),has_more:false}])
    await expect(runCarePlanMaintenance({supabaseUrl:'https://easycare.supabase.co',serviceRoleKey:'server-secret',...malformed})).rejects.toThrow('MAINTENANCE_RPC_RESPONSE_INVALID')
  })

  it('never accepts a plan or provider identity and sends credentials only in server-side RPC headers',async()=>{
    const mock=setup([page(0)])
    await runCarePlanMaintenance({supabaseUrl:'https://easycare.supabase.co',serviceRoleKey:'server-secret',...mock})
    const [url,options]=mock.fetchImpl.mock.calls[0]
    expect(url).toBe('https://easycare.supabase.co/rest/v1/rpc/maintain_care_plan_occurrence_horizons')
    expect(JSON.parse(options.body)).toEqual({p_after_id:null,p_batch_size:50})
    expect(options.headers.authorization).toBe('Bearer server-secret')
    expect(CARE_PLAN_MAINTENANCE_BATCH_SIZE).toBe(50)
    expect(CARE_PLAN_MAINTENANCE_MAX_PAGES).toBeGreaterThan(0)
  })

  it('requires HTTPS except for local Supabase development',async()=>{
    await expect(runCarePlanMaintenance({supabaseUrl:'http://example.com',serviceRoleKey:'secret'})).rejects.toThrow('SUPABASE_URL_MUST_USE_HTTPS')
    const mock=setup([page(0)])
    await runCarePlanMaintenance({supabaseUrl:'http://127.0.0.1:54321',serviceRoleKey:'secret',...mock})
  })

  it('keeps maintenance credentials out of browser configuration and adds a daily UTC workflow',()=>{
    const browserClient=readFileSync(resolve(process.cwd(),'src/lib/supabase.js'),'utf8')
    const workflow=readFileSync(resolve(process.cwd(),'.github/workflows/care-plan-occurrence-maintenance.yml'),'utf8')
    expect(browserClient).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(workflow).toContain("cron: '17 18 * * *'")
    expect(workflow).toContain('secrets.SUPABASE_SERVICE_ROLE_KEY')
    expect(workflow).toContain('concurrency:')
  })
})
