import { supabase, supabaseConfiguration } from '../../lib/supabase.js'
import { createFixtureRepository } from './fixtureRepository.js'
import { createSupabaseRepository } from './supabaseRepository.js'
import { HACKATHON_PROTOTYPE } from '../../lib/prototypeMode.js'

export function createRepository({ mode = supabaseConfiguration.mode, client = supabase } = {}) {
  return mode === 'supabase' ? createSupabaseRepository(client) : createFixtureRepository()
}

export const presentationRepository = HACKATHON_PROTOTYPE ? createFixtureRepository({ persist: true }) : createRepository()
