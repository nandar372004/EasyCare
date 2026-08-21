import { supabase, supabaseConfiguration } from '../../lib/supabase.js'
import { createFixtureRepository } from './fixtureRepository.js'
import { createSupabaseRepository } from './supabaseRepository.js'

export function createRepository({ mode = supabaseConfiguration.mode, client = supabase } = {}) {
  return mode === 'supabase' ? createSupabaseRepository(client) : createFixtureRepository()
}

export const presentationRepository = createRepository()
