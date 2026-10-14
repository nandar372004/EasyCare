// All reads use the authenticated user's client, never service-role access.
// Bounded datasets explicitly report truncation; absent data is never normal data.
export async function buildHealthContext(client: any, patientId: string, at: Date) {
  const end=at.toISOString(), start=new Date(+at-30*86400000).toISOString()
  const medicationDate=new Date(+at+390*60000).toISOString().slice(0,10) // Asia/Yangon (UTC+06:30).
  const read=async(query:any)=>{const {data,error}=await query;if(error) throw new Error('CONTEXT_UNAVAILABLE');return data}
  const source=async(table:string,columns:string,filter:(q:any)=>any,date?:string)=>{
    let q=filter(client.from(table).select(columns).eq('patient_id',patientId))
    if(date) q=q.order(date,{ascending:table==='appointments',nullsFirst:false})
    const rows=await read(q.order('id').limit(501))
    if(rows.some((row:any)=>row.patient_id!==patientId)) throw new Error('CONTEXT_OWNERSHIP_MISMATCH')
    return {table,rows:rows.slice(0,500),truncated:rows.length>500}
  }
  const [vitals,conditions,allergies,medications,medicationEvents,labs,encounters,appointments,alerts]=await Promise.all([
    source('vital_readings','id, patient_id, recorded_at, systolic_bp, diastolic_bp, heart_rate, spo2, temperature_c, glucose_mg_dl, weight_kg, source_type',q=>q.gte('recorded_at',start).lte('recorded_at',end),'recorded_at'),
    source('patient_conditions','id, patient_id, condition_name, status, severity, onset_date',q=>q.eq('status','active')),
    source('patient_allergies','id, patient_id, allergen, reaction, severity, status',q=>q.eq('status','active')),
    source('patient_medications','id, patient_id, medication_name, dose, frequency, start_date, end_date, status',q=>q.eq('status','active').or(`start_date.is.null,start_date.lte.${medicationDate}`).or(`end_date.is.null,end_date.gte.${medicationDate}`)),
    source('medication_events','id, patient_id, schedule_id, scheduled_at, status, confirmed_at',q=>q.gte('scheduled_at',start).lte('scheduled_at',end),'scheduled_at'),
    source('lab_results','id, patient_id, test_code, test_name, value_numeric, value_text, unit, reference_low, reference_high, abnormal_flag, result_status, observed_at, verified_at, created_at',q=>q.in('result_status',['preliminary','final','corrected']).or(`observed_at.gte.${start},created_at.gte.${start}`).or(`observed_at.is.null,observed_at.lte.${end}`).lte('created_at',end),'observed_at'),
    source('care_encounters','id, patient_id, encounter_type, status, chief_complaint, assessment_summary, care_plan, started_at, ended_at, created_at',q=>q.gte('created_at',start).lte('created_at',end),'created_at'),
    source('appointments','id, patient_id, scheduled_start, scheduled_end, appointment_type, status',q=>q.in('status',['pending','confirmed']).gte('scheduled_start',end),'scheduled_start'),
    source('monitoring_alerts','id, patient_id, alert_type, severity, message, status, detected_at, source_type, source_id',q=>q.in('status',['open','acknowledged','escalated']),'created_at'),
  ])
  const medicationIds=medications.rows.map((row:any)=>row.id)
  const links=medicationIds.length?await read(client.from('medication_schedules').select('id, patient_medication_id')
    .in('patient_medication_id',medicationIds).order('id').limit(501)):[]
  if(links.some((row:any)=>!medicationIds.includes(row.patient_medication_id))) throw new Error('CONTEXT_OWNERSHIP_MISMATCH')
  // Latest values may predate the trend window. Retain their actual timestamps.
  const metrics=['systolic_bp','diastolic_bp','heart_rate','spo2','temperature_c','glucose_mg_dl','weight_kg']
  const latestVitals=Object.fromEntries(await Promise.all(metrics.map(async metric=>[metric,await read(client.from('vital_readings')
    .select(`id, patient_id, recorded_at, ${metric}`).eq('patient_id',patientId).not(metric,'is',null).lte('recorded_at',end)
    .order('recorded_at',{ascending:false}).order('id').limit(1).maybeSingle())])))
  const vitalTrends=Object.fromEntries(metrics.map(metric=>{
    const points=vitals.rows.filter((r:any)=>r[metric]!=null).slice().reverse()
    return [metric,{count:points.length,first:points[0]??null,last:points.at(-1)??null,
      delta:points.length>1?Number(points.at(-1)[metric])-Number(points[0][metric]):null}]
  }))
  appointments.rows.sort((a:any,b:any)=>a.scheduled_start.localeCompare(b.scheduled_start))
  return {patientId,window:{days:30},latestVitals,vitalTrends,medicationScheduleLinks:{table:'medication_schedules',rows:links.slice(0,500),truncated:links.length>500},sources:{vitals,conditions,allergies,medications,medicationEvents,labs,encounters,appointments,alerts},
    upcomingAppointment:appointments.rows[0]??null}
}
