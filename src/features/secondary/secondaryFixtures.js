export const PRESENTATION_ONLY = 'Synthetic presentation information — no real service is connected.'

export const invoices = [
  { id: 'INV-2045', date: 'Aug 20, 2026', description: 'Video consultation', status: 'Paid', amount: '25,000 MMK' },
  { id: 'INV-2019', date: 'Jul 28, 2026', description: 'Voice consultation', status: 'Paid', amount: '20,000 MMK' },
  { id: 'INV-1988', date: 'Jun 18, 2026', description: 'Chat consultation', status: 'Refunded', amount: '15,000 MMK' },
]

export const MANDALAY_MAP = { lat: 21.9588, lng: 96.0891, zoom: 13, query: 'Mandalay, Myanmar' }
const MANDALAY_BOUNDS = { north: 22.04, south: 21.88, west: 96.02, east: 96.16 }

export const facilities = [
  { id: 1, name: 'Mandalay General Hospital', type: 'Hospital', city: 'Mandalay', lat: 21.9818, lng: 96.0845, distance: '1.2 km', hours: 'Open 24/7' },
  { id: 2, name: 'Mandalay Children\'s Hospital', type: 'Hospital', city: 'Mandalay', lat: 21.9765, lng: 96.0898, distance: '1.8 km', hours: 'Open 24/7' },
  { id: 3, name: 'Mandalay Orthopaedic Hospital', type: 'Hospital', city: 'Mandalay', lat: 21.9705, lng: 96.0960, distance: '2.6 km', hours: 'Open 24/7' },
  { id: 4, name: 'Mandalay City Clinic', type: 'Clinic', city: 'Mandalay', lat: 21.9720, lng: 96.0835, distance: '1.5 km', hours: '8 AM–8 PM' },
  { id: 5, name: 'Chan Myae Specialist Clinic', type: 'Clinic', city: 'Mandalay', lat: 21.9510, lng: 96.0910, distance: '2.1 km', hours: '8 AM–6 PM' },
  { id: 6, name: 'AA Pharmacy Mandalay', type: 'Pharmacy', city: 'Mandalay', lat: 21.9675, lng: 96.0820, distance: '1.4 km', hours: '9 AM–9 PM' },
  { id: 7, name: 'City Mart Pharmacy Mandalay', type: 'Pharmacy', city: 'Mandalay', lat: 21.9540, lng: 96.0945, distance: '2.3 km', hours: '9 AM–9 PM' },
  { id: 8, name: 'Mandalay Public Health Laboratory', type: 'Lab', city: 'Mandalay', lat: 21.9780, lng: 96.0870, distance: '1.7 km', hours: '8 AM–5 PM' },
  { id: 9, name: 'Gold Medical Laboratory Mandalay', type: 'Lab', city: 'Mandalay', lat: 21.9610, lng: 96.0885, distance: '2.0 km', hours: '8 AM–5 PM' },
  { id: 99, name: 'Yangon General Hospital', type: 'Hospital', city: 'Yangon', lat: 16.7794, lng: 96.1490, distance: '620 km', hours: 'Open 24/7' },
]

export function isMandalayFacility(facility) {
  return facility?.city === 'Mandalay'
}

export function nearbyMandalayFacilities(all = facilities, { type = 'All', query = '' } = {}) {
  const needle = query.trim().toLowerCase()
  return all.filter((facility) => {
    if (!isMandalayFacility(facility)) return false
    if (type !== 'All' && facility.type !== type) return false
    if (!needle) return true
    return `${facility.name} ${facility.type}`.toLowerCase().includes(needle)
  })
}

export function googleMapsEmbedUrl(visible, type = 'All') {
  const topic = visible.length === 1
    ? `${visible[0].name}, Mandalay, Myanmar`
    : type !== 'All' && visible.length > 0
      ? `${type} in Mandalay, Myanmar`
      : MANDALAY_MAP.query
  const zoom = visible.length === 1 ? 15 : MANDALAY_MAP.zoom
  return `https://maps.google.com/maps?q=${encodeURIComponent(topic)}&z=${zoom}&output=embed`
}

export function googleMapsDirectionsUrl(facility) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${facility.name}, Mandalay, Myanmar`)}`
}

export function mapMarkerPosition(facility) {
  const x = ((facility.lng - MANDALAY_BOUNDS.west) / (MANDALAY_BOUNDS.east - MANDALAY_BOUNDS.west)) * 100
  const y = ((MANDALAY_BOUNDS.north - facility.lat) / (MANDALAY_BOUNDS.north - MANDALAY_BOUNDS.south)) * 100
  return { left: `${Math.min(92, Math.max(8, x))}%`, top: `${Math.min(92, Math.max(8, y))}%` }
}
