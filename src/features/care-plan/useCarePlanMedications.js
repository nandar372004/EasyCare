import { useQuery, useQueryClient } from '@tanstack/react-query'
import { carePlanMedicationQueryKey, loadCarePlanClinicalSource, loadCarePlanMedications } from '../../services/carePlanMedicationService.js'

export function useCarePlanMedications(auth, today) {
  const client = useQueryClient()
  const patientId = auth.patient?.id
  const queryKey = carePlanMedicationQueryKey(auth.user?.id, patientId, today)
  const query = useQuery({ queryKey, enabled: Boolean(patientId), queryFn: () => loadCarePlanMedications(patientId, {
    clinicalLoader: async () => (await loadCarePlanClinicalSource(patientId, { queryClient: client, viewerId: auth.user?.id, today })).records,
  }), staleTime: 30_000, gcTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false })
  return { status: query.data ? 'ready' : query.isError || !patientId ? 'error' : 'loading', data: query.data,
    retry: () => query.refetch(), updateData: updater => client.setQueryData(queryKey, updater) }
}
