import { PRESENTATION_TIME_ZONE } from '../data/presentationFixtures.js'

export function formatPresentationDateTime(value, locale = 'en-MM') {
  return new Intl.DateTimeFormat(locale, {
    timeZone: PRESENTATION_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatMmk(value, locale = 'en-MM') {
  if (!Number.isInteger(value)) throw new TypeError('MMK values must be integers.')
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} MMK`
}
