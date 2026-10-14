// Presentation-only Family Health cards. These fixtures are consumed only by
// the authorized Family Health readout and never enter patient history APIs.
const presentationRecords = Object.freeze([
  Object.freeze({
    target: Object.freeze({ displayName: 'Kyaw Aung Moe', relationship: 'father' }),
    record: Object.freeze({
      id: 'presentation-kyaw-blood-pressure',
      title: 'Blood Pressure Monitoring',
      type: 'Patient Health Record',
      latestReading: '145 / 92 mmHg',
      recordedLabel: 'Oct 12, 2026',
      status: 'Monitoring',
      summary: 'Blood pressure has been recorded for ongoing monitoring.',
      recentReadings: Object.freeze([
        Object.freeze({ date: 'Oct 12, 2026', value: '145 / 92 mmHg' }),
        Object.freeze({ date: 'Oct 10, 2026', value: '142 / 90 mmHg' }),
        Object.freeze({ date: 'Oct 8, 2026', value: '138 / 88 mmHg' }),
      ]),
    }),
  }),
  Object.freeze({
    target: Object.freeze({ displayName: 'Shwe Hnin San', relationship: 'mother' }),
    record: Object.freeze({
      id: 'presentation-shwe-blood-sugar',
      title: 'Blood Sugar Monitoring',
      type: 'Patient Health Record',
      latestReading: '128 mg/dL',
      recordedLabel: 'Oct 12, 2026',
      status: 'Monitoring',
      summary: 'Blood sugar has been recorded for ongoing monitoring.',
      recentReadings: Object.freeze([
        Object.freeze({ date: 'Oct 12, 2026', value: '128 mg/dL' }),
        Object.freeze({ date: 'Oct 10, 2026', value: '122 mg/dL' }),
        Object.freeze({ date: 'Oct 8, 2026', value: '126 mg/dL' }),
      ]),
    }),
  }),
  Object.freeze({
    target: Object.freeze({ displayName: 'Eaindray Kyaw', relationship: 'sibling' }),
    record: Object.freeze({
      id: 'presentation-eaindray-right-knee-follow-up',
      title: 'Right Knee Follow-up',
      type: 'Musculoskeletal Health Record',
      recordedLabel: 'Oct 12, 2026',
      status: 'Monitoring',
      summary: 'Right knee discomfort is being monitored during activity and recovery.',
      details: Object.freeze([
        Object.freeze({ label: 'Pain during activity', value: 'Mild' }),
        Object.freeze({ label: 'Mobility', value: 'Maintained' }),
        Object.freeze({ label: 'Current plan', value: 'Activity modification and follow-up monitoring' }),
      ]),
    }),
  }),
])

export function getFamilyPresentationHealthRecord(member) {
  if (!member?.member_id || !member?.patient_id || member.is_self || typeof member.display_name !== 'string') return null
  const name = member.display_name.trim().toLocaleLowerCase()
  const relationship = member.relationship?.trim().toLocaleLowerCase()
  return presentationRecords.find(sample => sample.target.displayName.toLocaleLowerCase() === name
    && sample.target.relationship === relationship)?.record || null
}
