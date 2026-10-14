import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { createDashboardQueryResources, DASHBOARD_STALE_MS, dashboardKey, measureDashboardLoad } from '../../services/dashboardQueryService.js'
import { getPatientOnboarding } from '../../services/patientOnboardingService.js'
import { familyCommandCenterService } from '../../services/familyCommandCenterService.js'
import { patientMonitoringService } from '../../services/patientMonitoringService.js'
import { patientHealthGoalService } from '../../services/patientHealthGoalService.js'
import { isFamilyAdult } from '../family/familyEligibility.js'

export const dashboardDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const queryState = query => ({ status: query.data !== undefined ? 'ready' : query.isError ? 'error' : 'loading', data: query.data, refreshing: query.isFetching && query.data !== undefined })

export function useDashboardData(auth) {
  const queryClient = useQueryClient()
  const patientId = auth.patient?.id
  const viewerId = auth.user?.id || patientId
  const [day, setDay] = useState(dashboardDay)
  const patient = useMemo(() => auth.patient, [patientId, auth.patient?.full_name, auth.patient?.date_of_birth])
  const resources = useMemo(() => patientId ? createDashboardQueryResources({ queryClient, patient, viewerId, day }) : null, [queryClient, patient, viewerId, day, patientId])
  const common = { enabled: Boolean(patientId), staleTime: DASHBOARD_STALE_MS, gcTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false }
  const taskEntries = resources ? Object.entries(resources.tasks) : []
  const queries = useQueries({ queries: taskEntries.map(([name, queryFn]) => ({ ...common, queryKey: resources.key(name), queryFn: () => measureDashboardLoad(name, queryFn) })) })
  const sections = Object.fromEntries(taskEntries.map(([name], index) => [name, queryState(queries[index])]))
  const key = resource => dashboardKey(viewerId, patientId, day, resource)
  const onboardingQuery = useQuery({ ...common, queryKey: key('onboarding'), queryFn: () => getPatientOnboarding() })
  const monitoringQuery = useQuery({ ...common, queryKey: key('monitoring'), queryFn: async () => {
    const [plans, checkIns] = await Promise.all([patientMonitoringService.listMyPlans(), patientMonitoringService.listMyCheckIns()])
    return { plans, checkIns }
  } })
  const goalsQuery = useQuery({ ...common, queryKey: key('goals'), queryFn: () => patientHealthGoalService.listMyGoals() })
  // Protected family details have no route-revisit cache. Each required load
  // still uses the existing grant scopes and final directory recheck.
  const familyQuery = useQuery({ ...common, enabled: Boolean(patientId && isFamilyAdult(patient?.date_of_birth)),
    queryKey: key('family'), staleTime: 0, gcTime: 0, refetchOnMount: 'always',
    queryFn: () => familyCommandCenterService.load(patient, { sharedOwnSections: resources.sharedOwnSections }) })
  const [familyHidden, setFamilyHidden] = useState(false)
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    setFamilyHidden(false); setExpired(false)
    const expiryText = familyQuery.data?.accessExpiresAt
    if (!expiryText) return undefined
    const expiry = Date.parse(expiryText)
    let timer
    const check = () => {
      const remaining = expiry - Date.now()
      if (!Number.isFinite(expiry) || remaining <= 0) setExpired(true)
      else timer = window.setTimeout(check, Math.min(2147483647, remaining))
    }
    check()
    return () => window.clearTimeout(timer)
  }, [familyQuery.data, familyQuery.dataUpdatedAt, patientId, viewerId])
  useEffect(() => {
    if (!patientId || !isFamilyAdult(patient?.date_of_birth)) return undefined
    const refresh = () => {
      setFamilyHidden(true)
      void familyQuery.refetch({ cancelRefetch: false }).finally(() => setFamilyHidden(false))
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [patientId, viewerId, patient?.date_of_birth, familyQuery.refetch])
  useEffect(() => {
    // Switch all date-scoped query keys at Yangon midnight, also after sleep.
    const update = () => setDay(dashboardDay())
    const timer = window.setInterval(update, 60_000)
    window.addEventListener('focus', update)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update) }
  }, [])
  const expiry = familyQuery.data?.accessExpiresAt && Date.parse(familyQuery.data.accessExpiresAt)
  const expiryInvalid = familyQuery.data?.accessExpiresAt && (!Number.isFinite(expiry) || expiry <= Date.now())
  const family = expired || expiryInvalid || familyQuery.isError ? { status: 'error', members: [] }
    : familyHidden || familyQuery.isFetching || !familyQuery.data ? null : { ...familyQuery.data, status: 'ready' }
  return { sections, monitoring: queryState(monitoringQuery), goals: queryState(goalsQuery), family,
    onboarding: onboardingQuery.data || (onboardingQuery.isError ? { status: 'not_started' } : null) }
}
