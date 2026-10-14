export const CERVICAL_REMINDER_INTERVAL_MS = 8000
export const SPONDYLOSIS_REMINDER_INTERVAL_MS = 10000
export const CERVICAL_REMINDERS = Object.freeze([
  ['လည်ပင်းလေ့ကျင့်ခန်း လုပ်ဖို့ မမေ့နော်', "Don't forget to do your neck exercises."],
  ['ဒီနေ့ လည်ပင်းကို အနားပေးဖို့ လိုတယ်နော်', 'You need to give your neck some rest today.'],
  ['ဖုန်းကို အောက်ချပြီး လည်ပင်းကို ဆန့်ထုတ်လိုက်ပါ', 'Put your phone down and stretch your neck.'],
  ['ထိုင်တဲ့အခါ ကိုယ်ဟန်အနေအထား မှန်ဖို့ သတိရပါ', 'Remember to keep good posture when sitting.'],
  ['လည်ပင်းနာကျင်နေရင် ဆေးသောက်ဖို့ မမေ့ပါနဲ့', "If your neck is hurting, don't forget to take your medicine."],
  ['ဒီနေ့ လည်ပင်းလှုပ်ရှားမှု လေ့ကျင့်ခန်း ၅ မိနစ် လုပ်ပါ', 'Do 5 minutes of neck mobility exercises today.'],
  ['အလုပ်ကြားထဲမှာ ခဏထရပ်ပြီး လည်ပင်းကို လှုပ်ပေးပါ', 'Take a short break from work, stand up, and move your neck.'],
  ['ခေါင်းအုံး အမြင့်များလွန်းရင် လည်ပင်းကို ထိခိုက်နိုင်တယ်နော်', 'If your pillow is too high, it can affect your neck.'],
  ['လည်ပင်းကို အေးနေစေဖို့ သတိထားပါ', 'Be careful to keep your neck warm.'],
  ['သင့်ရဲ့ လည်ပင်းကျီးပေါင်း အခြေအနေ ဘယ်လိုရှိလဲ။ နေ့စဉ် မှတ်တမ်းတင်ပါ', 'How is your neck spondylosis condition? Log it daily.'],
].map(([my, en]) => Object.freeze({ my, en })))

export function wellnessSessionId(session) {
  try {
    const part = session?.access_token?.split('.')[1]
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
    const id = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))).session_id
    return /^[0-9a-f-]{36}$/i.test(id || '') ? id : null
  } catch { return null }
}

// Memory fallback preserves deduplication when browser storage is unavailable.
const progress = new Map()
export function readSequence(key) {
  if (progress.has(key)) return progress.get(key)
  try {
    const saved = JSON.parse(sessionStorage.getItem(key))
    if (['WELLNESS_FIRST', 'MEDICATION_SECOND', 'WAITING_8_SECONDS', 'SPONDYLOSIS_THIRD', 'COMPLETE'].includes(saved?.stage)
      && (!['WAITING_8_SECONDS', 'SPONDYLOSIS_THIRD'].includes(saved.stage) || Number.isFinite(saved.nextAt))
      && (saved.stage !== 'SPONDYLOSIS_THIRD' || (Number.isInteger(saved.index) && saved.index >= 0 && saved.index < CERVICAL_REMINDERS.length))) return saved
    // Never restart a previously completed legacy session automatically.
    if (Number.isInteger(saved?.index)) return { stage: 'COMPLETE' }
  } catch { /* Session storage can be unavailable. */ }
  return null
}
export function saveSequence(key, value) {
  progress.set(key, value)
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* Memory fallback. */ }
}

export function resetSequenceForDevelopment(key) {
  if (!/^easycare\.cervical-wellness\.v1:[0-9a-f-]{36}$/i.test(key || '')) return false
  progress.delete(key)
  // Clear only this exact reminder/session key; never touch authentication.
  for (const storageName of ['sessionStorage', 'localStorage']) {
    try { globalThis[storageName]?.removeItem(key) } catch { /* Browser storage may be unavailable. */ }
  }
  return true
}
