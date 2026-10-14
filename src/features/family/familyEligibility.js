function localDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function subtractYearsClamped(dateString, years) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString || '')
  if (!match) return null
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const sourceDate = new Date(Date.UTC(year, month - 1, day))
  if (sourceDate.getUTCFullYear() !== year || sourceDate.getUTCMonth() !== month - 1 || sourceDate.getUTCDate() !== day) return null

  const targetYear = year - years
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
  return `${String(targetYear).padStart(4, '0')}-${monthText}-${String(Math.min(day, lastDayOfTargetMonth)).padStart(2, '0')}`
}

// Mirrors `DOB <= current_date - interval '18 years'` using date-only values.
// The UI check is for usability; the family RPC remains authoritative.
export function isFamilyAdult(dateOfBirth, today = localDateString(new Date())) {
  const cutoff = subtractYearsClamped(today, 18)
  return Boolean(cutoff && subtractYearsClamped(dateOfBirth, 0) && dateOfBirth <= cutoff)
}
