import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import { createAdminProviderManagementHandler } from '../_shared/admin-provider-management.js'

Deno.serve(createAdminProviderManagementHandler({ createClient, env: Deno.env }))
