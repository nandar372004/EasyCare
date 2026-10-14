# Prepared operator command; never run automatically.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$stageProject = 'xyprybspwrtthvhnumdp'
if ((Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim() -ne $stageProject) {
  throw 'The linked project must be EasyCare Staging.'
}
node node_modules/supabase/dist/supabase.js db query --linked --project-ref $stageProject --file supabase/migrations/20261008091000_phase_j_monitoring_alert_read_privileges.sql
if ($LASTEXITCODE -ne 0) { throw 'Alert privilege repair failed; migration history was not changed.' }
node node_modules/supabase/dist/supabase.js migration repair 20261008091000 --status applied --linked --project-ref $stageProject
if ($LASTEXITCODE -ne 0) { throw 'Grant committed but history recording failed. Record only version 20261008091000 before continuing.' }
