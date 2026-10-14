# Prepared operator command. Do not run automatically.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$stageProject = 'xyprybspwrtthvhnumdp'
if ((Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim() -ne $stageProject) {
  throw 'The linked project must be EasyCare Staging.'
}
node node_modules/supabase/dist/supabase.js db query --linked --project-ref $stageProject --file supabase/migrations/20261008094000_revert_dual_role_family_patient_capability.sql
if ($LASTEXITCODE -ne 0) { throw 'Dual-role family rollback failed; migration history was not changed.' }
node node_modules/supabase/dist/supabase.js migration repair 20261008094000 --status applied --linked --project-ref $stageProject
if ($LASTEXITCODE -ne 0) { throw 'Family RPC rollback committed but history recording failed. Record only version 20261008094000 before continuing.' }
