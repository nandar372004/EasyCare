# Prepared operator command. Do not run automatically.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$stageProject = 'xyprybspwrtthvhnumdp'
if ((Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim() -ne $stageProject) {
  throw 'The linked project must be EasyCare Staging.'
}
node node_modules/supabase/dist/supabase.js db query --linked --project-ref $stageProject --file supabase/migrations/20261009090000_family_friend_lover_relationships.sql
if ($LASTEXITCODE -ne 0) { throw 'Family relationship vocabulary migration failed; migration history was not changed.' }
node node_modules/supabase/dist/supabase.js migration repair 20261009090000 --status applied --linked --project-ref $stageProject
if ($LASTEXITCODE -ne 0) { throw 'Family relationship vocabulary migration committed but history recording failed. Record only version 20261009090000 before continuing.' }
