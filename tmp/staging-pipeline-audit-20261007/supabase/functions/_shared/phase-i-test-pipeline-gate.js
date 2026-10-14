export const PHASE_I_TEST_STAGING_PROJECT_REF = 'xyprybspwrtthvhnumdp'

export function isPhaseITestPipelineEnabled({ flag, supabaseUrl } = {}) {
  if (flag !== 'true' || typeof supabaseUrl !== 'string') return false
  try {
    const projectUrl = new URL(supabaseUrl)
    return projectUrl.protocol === 'https:'
      && projectUrl.hostname.toLowerCase() === `${PHASE_I_TEST_STAGING_PROJECT_REF}.supabase.co`
  } catch {
    return false
  }
}
