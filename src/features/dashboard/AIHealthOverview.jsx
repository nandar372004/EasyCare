import { useEffect, useState } from 'react'
import { getAIHealthOverview } from '../../services/aiHealthOverviewService.js'

export function AIHealthOverview({patientId}) {
  const [result,setResult]=useState(null)
  useEffect(()=>{
    let active=true
    setResult(null)
    if(!patientId) { return undefined }
    (async()=>getAIHealthOverview(patientId))().then(data=>{if(active)setResult({patientId,...data})})
      .catch(()=>{if(active)setResult({patientId,summary:null,fallback:{summary:'AI overview is temporarily unavailable.',guidance:[]}})})
    return ()=>{active=false}
  },[patientId])
  const current=result?.patientId===patientId?result:null
  const summary=current?.summary
  return <article className="card dashboard-health-summary" aria-label="AI Health Overview">
    <div className="section-title"><h2>AI Health Overview</h2></div>
    <p>Derived information, not a diagnosis or a replacement for clinical care.</p>
    {!patientId ? <p>Sign in with a patient account to view an overview.</p> : !current ? <p role="status">Loading your health overview...</p> : summary ? <>
      <p>{summary.overall_status==='fallback'?'Safety fallback — AI overview unavailable':'AI-generated overview — clinician review recommended'}</p>
      <p>Overall Status: {summary.overall_status}</p>
      <p>{summary.summary_text}</p>
      <h3>Things to Watch</h3>
      {summary.things_to_watch?.length ? <ul>{summary.things_to_watch.map((item,index)=><li key={index}>{item}</li>)}</ul> : <p>No watch items provided in this overview.</p>}
      <h3>Recommended Actions</h3>
      <ul>{summary.recommended_actions.map((action,index)=><li key={index}>{action}</li>)}</ul>
      <small>Generated <time dateTime={summary.generated_at}>{new Date(summary.generated_at).toLocaleString('en-US',{timeZone:'Asia/Yangon'})}</time> (Asia/Yangon)</small>
    </> : <div className="dashboard-empty"><p>{current.fallback.summary}</p><ul>{current.fallback.guidance.map((text,i)=><li key={i}>{text}</li>)}</ul></div>}
  </article>
}
