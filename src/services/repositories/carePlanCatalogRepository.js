import { supabase } from '../../lib/supabase.js'

function failure(error, message) {
  if (!error) return null
  const value = new Error(message)
  value.code = error.code || 'HOME_CARE_CATALOG_FAILED'
  throw value
}

export function createCarePlanCatalogRepository(client = supabase) {
  if (!client) throw new Error('Home Care pricing requires a configured EasyCare account.')
  return {
    async listPackages() {
      const [{ data: packages, error: packageError }, { data: links, error: linkError }, { data: services, error: serviceError }] = await Promise.all([
        client.from('care_packages')
          .select('id,code,name,active,service_type,duration_unit,allowed_duration_days')
          .eq('active', true).eq('service_type', 'home_care').order('name'),
        client.from('package_services').select('package_id,service_id'),
        client.from('service_catalog')
          .select('id,code,name,service_type,base_price,currency,active,care_level_code,base_price_unit')
          .eq('active', true).eq('service_type', 'home_visit').eq('base_price_unit', 'day'),
      ])
      failure(packageError || linkError || serviceError, 'Unable to load Home Care options.')
      const serviceById = new Map((services || []).map(service => [service.id, service]))
      const linksByPackage = new Map()
      for (const link of links || []) {
        const service = serviceById.get(link.service_id)
        if (!service?.care_level_code || !service.active || service.currency !== 'MMK') continue
        const options = linksByPackage.get(link.package_id) || []
        options.push({
          id: service.id,
          code: service.care_level_code,
          name: service.name,
          unitPrice: Number(service.base_price),
          currency: service.currency,
        })
        linksByPackage.set(link.package_id, options)
      }
      return (packages || []).map(item => ({
        id: item.id,
        code: item.code,
        name: item.name,
        serviceType: item.service_type,
        durationUnit: item.duration_unit,
        allowedDurationDays: item.allowed_duration_days || [],
        levels: linksByPackage.get(item.id) || [],
      })).filter(item => item.code && item.levels.length)
    },
    async quote(packageId, serviceId, durationDays) {
      const { data, error } = await client.rpc('quote_home_care_package', {
        p_package_id: packageId,
        p_service_id: serviceId,
        p_duration_days: durationDays,
      })
      failure(error, 'Unable to calculate the Home Care quote.')
      return Array.isArray(data) ? data[0] || null : data
    },
  }
}
