import { pathToFileURL } from 'node:url'

export const CARE_PLAN_MAINTENANCE_BATCH_SIZE = 50
export const CARE_PLAN_MAINTENANCE_MAX_PAGES = 500

function validUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function runCarePlanMaintenance({ supabaseUrl, serviceRoleKey, fetchImpl = fetch, log = console.log, maxPages = CARE_PLAN_MAINTENANCE_MAX_PAGES }) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error('MAINTENANCE_CONFIGURATION_MISSING')
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('MAINTENANCE_PAGE_CAP_INVALID')

  const base = new URL(supabaseUrl)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
    throw new Error('SUPABASE_URL_MUST_USE_HTTPS')
  }
  const endpoint = `${base.origin}${base.pathname.replace(/\/$/, '')}/rest/v1/rpc/maintain_care_plan_occurrence_horizons`
  let cursor = null
  let pages = 0
  let processed = 0
  let generated = 0
  const failures = []

  while (true) {
    if (pages >= maxPages) {
      log(JSON.stringify({ event: 'care_plan_maintenance_page_cap', pages, processed, generated, cursor }))
      throw new Error('MAINTENANCE_PAGE_CAP_REACHED')
    }

    let response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ p_after_id: cursor, p_batch_size: CARE_PLAN_MAINTENANCE_BATCH_SIZE }),
      })
    } catch {
      throw new Error('MAINTENANCE_RPC_TRANSPORT_FAILED')
    }
    if (!response.ok) throw new Error(`MAINTENANCE_RPC_HTTP_${response.status}`)

    let page
    try {
      page = await response.json()
    } catch {
      throw new Error('MAINTENANCE_RPC_RESPONSE_INVALID')
    }
    if (!page || !Number.isInteger(page.processed) || page.processed < 0 || page.processed > CARE_PLAN_MAINTENANCE_BATCH_SIZE ||
        !Number.isInteger(page.generated) || page.generated < 0 || !Array.isArray(page.failures) || typeof page.has_more !== 'boolean') {
      throw new Error('MAINTENANCE_RPC_RESPONSE_INVALID')
    }
    if (page.processed > 0 && !validUuid(page.next_after_id)) throw new Error('MAINTENANCE_RPC_CURSOR_INVALID')
    if (page.has_more && (!validUuid(page.next_after_id) || (cursor && page.next_after_id.toLowerCase() <= cursor.toLowerCase()))) {
      throw new Error('MAINTENANCE_RPC_CURSOR_DID_NOT_ADVANCE')
    }

    pages += 1
    processed += page.processed
    generated += page.generated
    for (const failure of page.failures) {
      failures.push({
        plan_id: validUuid(failure?.plan_id) ? failure.plan_id : null,
        sqlstate: typeof failure?.sqlstate === 'string' ? failure.sqlstate.slice(0, 5) : 'UNKNOWN',
      })
    }
    log(JSON.stringify({
      event: 'care_plan_maintenance_page',
      page: pages,
      processed: page.processed,
      generated: page.generated,
      failures: page.failures.map(failure => ({
        plan_id: validUuid(failure?.plan_id) ? failure.plan_id : null,
        sqlstate: typeof failure?.sqlstate === 'string' ? failure.sqlstate.slice(0, 5) : 'UNKNOWN',
      })),
      has_more: page.has_more,
      next_after_id: page.next_after_id ?? null,
    }))

    if (!page.has_more) break
    cursor = page.next_after_id
  }

  const summary = { pages, processed, generated, failure_count: failures.length, failures }
  log(JSON.stringify({ event: 'care_plan_maintenance_complete', ...summary }))
  return summary
}

async function main() {
  const summary = await runCarePlanMaintenance({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })
  if (summary.failure_count > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const code = error instanceof Error ? error.message : 'MAINTENANCE_RUN_FAILED'
    console.error(JSON.stringify({ event: 'care_plan_maintenance_failed', code }))
    process.exitCode = 1
  })
}
