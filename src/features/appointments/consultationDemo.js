export const CONSULTATION_DEMO_NOTICE = 'Presentation Demo — No live doctor or production video service is connected.'

export function getConsultationEligibility(appointment, now = new Date()) {
  if (!appointment) return { eligible: false, reason: 'This appointment was not found or does not belong to the signed-in patient.' }
  if (appointment.consultationType === 'home_visit') return { eligible: false, reason: 'Home visits do not have online consultation access.' }
  if (['cancelled', 'completed', 'no_show'].includes(appointment.status)) return { eligible: false, reason: `${appointment.status[0].toUpperCase() + appointment.status.slice(1)} appointments cannot enter the waiting room.` }
  if (!['pending', 'confirmed', 'checked_in'].includes(appointment.status)) return { eligible: false, reason: 'This appointment is not eligible for waiting-room access.' }
  if (new Date(appointment.scheduledAt) <= now) return { eligible: false, reason: 'This appointment time has passed.' }
  return { eligible: true, reason: null }
}

function stableNumber(value) {
  return [...String(value)].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 7)
}

export function getDeterministicQueue(appointmentId) {
  const seed = stableNumber(appointmentId)
  return { queueNumber: (seed % 7) + 1, estimatedWaitMinutes: ((seed % 5) + 1) * 2 }
}

export function getCountdown(scheduledAt, now = new Date()) {
  const totalSeconds = Math.max(0, Math.floor((new Date(scheduledAt).getTime() - now.getTime()) / 1000))
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalSeconds,
  }
}

export const SYNTHETIC_CONSULTATION_SUMMARIES = Object.freeze([
  { id: 'summary-demo-001', date: '2026-07-15T04:15:00.000Z', doctorName: 'Dr. Demo Lotus', specialty: 'Dermatology', mode: 'Chat', outcome: 'Presentation summary available', status: 'completed' },
  { id: 'summary-demo-002', date: '2026-06-28T03:30:00.000Z', doctorName: 'Dr. Demo Aster', specialty: 'General Medicine', mode: 'Video', outcome: 'Synthetic follow-up example', status: 'completed' },
])
