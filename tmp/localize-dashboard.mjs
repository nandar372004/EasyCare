import fs from 'node:fs'
import {parse} from '@babel/parser'
import {dashboardKeys} from '../src/features/localization/dashboardTranslations.js'
const components={DashboardPage:['HealthWorld','NeedsAttentionCard','DashboardOperationalCards','DashboardPage'],DashboardMedications:['DashboardMedications'],HealthTrends:['HealthTrends','MonitoringTrendChart'],DashboardSkeleton:['DashboardSkeleton'],DashboardRouteSkeleton:['DashboardRouteSkeleton'],PatientHealthSections:['HealthSection']}
for(const [name,functions] of Object.entries(components)){
let path=`src/features/dashboard/${name}.jsx`,source=fs.readFileSync(path,'utf8');const ast=parse(source,{sourceType:'module',plugins:['jsx']});const edits=[]
function walk(n,inJSX=false,eligible=true){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration')eligible=functions.includes(n.id?.name)
if(eligible){
if(n.type==='JSXText'&&dashboardKeys[n.value.trim()]){const value=n.value.trim();edits.push({start:n.start,end:n.end,text:`${n.value.slice(0,n.value.indexOf(value))}{t(${JSON.stringify(value)})}${n.value.slice(n.value.indexOf(value)+value.length)}`});return}
if(n.type==='JSXAttribute'&&['aria-label','alt'].includes(n.name.name)&&n.value?.type==='StringLiteral'&&dashboardKeys[n.value.value]){edits.push({start:n.value.start,end:n.value.end,text:`{t(${JSON.stringify(n.value.value)})}`});return}
if(inJSX&&n.type==='ConditionalExpression')for(const child of [n.consequent,n.alternate])if(child.type==='StringLiteral'&&dashboardKeys[child.value])edits.push({start:child.start,end:child.end,text:`t(${JSON.stringify(child.value)})`})
}
for(const [k,v]of Object.entries(n)){if(k==='loc')continue;if(Array.isArray(v))v.forEach(c=>walk(c,inJSX||n.type==='JSXExpressionContainer',eligible));else if(v&&typeof v==='object')walk(v,inJSX||n.type==='JSXExpressionContainer',eligible)}}walk(ast)
edits.sort((a,b)=>b.start-a.start).forEach(e=>source=source.slice(0,e.start)+e.text+source.slice(e.end))
source="import { useDashboardTranslation } from './useDashboardTranslation.js'\n"+source
for(const func of functions)source=source.replace(new RegExp(`(function ${func}\\([^)]*\\)\\s*\\{)`),'$1\n  const t = useDashboardTranslation()')
// asOfDate default contains a parenthesis; insert explicitly.
if(name==='HealthTrends')source=source.replace("export function HealthTrends({ monitoring, asOfDate = today(), patientName = '' }) {", "export function HealthTrends({ monitoring, asOfDate = today(), patientName = '' }) {\n  const t = useDashboardTranslation()")
if(name==='PatientHealthSections')source=source.replace('return <article className="card patient-health-section" aria-label={title}>','return <article className="card patient-health-section" aria-label={t(title)}>').replace('<h2>{title}</h2>','<h2>{t(title)}</h2>').replace('{empty}</p>','{t(empty)}</p>')
if(name==='DashboardSkeleton')source=source.replace('aria-label={label}','aria-label={t(label)}').replace('{label}</span>','{t(label)}</span>')
if(name==='DashboardRouteSkeleton')source=source.replace('{greeting},','{t(greeting)},').replace("patient?.full_name || 'EasyCare Patient'", "patient?.full_name || t('EasyCare Patient')").replace('<h2>{title}</h2>','<h2>{t(title)}</h2>')
fs.writeFileSync(path,source)
}
