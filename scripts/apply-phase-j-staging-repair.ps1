# Operator-only: do not run until the Phase J repair is approved for Staging.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$stageProject = 'xyprybspwrtthvhnumdp'
$linkedProject = (Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim()
if ($linkedProject -ne $stageProject) { throw 'The linked project must be EasyCare Staging.' }
$migrationFile = 'supabase/migrations/20261008090000_phase_j_staging_read_contract_repair.sql'
node node_modules/supabase/dist/supabase.js db query --linked --project-ref $stageProject --file $migrationFile
if ($LASTEXITCODE -ne 0) { throw 'Repair failed; migration history was not changed.' }
# Record only this new version. Never mark skipped historical migrations applied.
node node_modules/supabase/dist/supabase.js migration repair 20261008090000 --status applied --linked --project-ref $stageProject
if ($LASTEXITCODE -ne 0) { throw 'Repair committed but history recording failed. Record only version 20261008090000 before continuing.' }
