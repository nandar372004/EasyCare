import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

export async function ensureClinicalDocumentsBucket(client) {
  const name = 'clinical-documents'
  const existing = await client.storage.getBucket(name)
  if (existing.data) {
    if (existing.data.public !== false) throw new Error('clinical-documents must be private; refusing to reuse a public bucket')
    return
  }
  if (Number(existing.error?.statusCode) !== 404) throw existing.error ?? new Error('Unable to inspect bucket')
  const { error } = await client.storage.createBucket(name, { public: false })
  if (error) throw error
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  await ensureClinicalDocumentsBucket(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }))
  console.log('Private clinical-documents bucket ready')
}
