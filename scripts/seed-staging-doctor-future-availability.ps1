param([switch]$Execute, [string]$Confirmation)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'staging-appointment-cleanup-guards.ps1')
$project = 'xyprybspwrtthvhnumdp'
Assert-StagingCleanupProject (Get-Content 'supabase/.temp/project-ref' -Raw)
$template = Get-Content (Join-Path $PSScriptRoot 'seed-staging-doctor-future-availability.sql') -Raw
$temp = Join-Path ([IO.Path]::GetTempPath()) ('easycare-availability-' + [guid]::NewGuid().ToString('N') + '.sql')
function Invoke-SeedQuery([bool]$Write, [string]$Fingerprint) {
  [IO.File]::WriteAllText($temp,$template.Replace('__EXECUTE__',$Write.ToString().ToLowerInvariant()).Replace('__EXPECTED_PLAN__',$Fingerprint))
  $json = (& node node_modules/supabase/dist/supabase.js db query --linked --project-ref $project --output json --output-format json --file $temp | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'Staging seed query failed; transaction did not complete.' }
  $summary = (Get-CleanupSqlPreviewRow $json).summary
  if ($summary.eligible_doctors -isnot [int] -or $summary.eligible_doctors -le 0 -or
      $summary.planned_inserts -isnot [int] -or $summary.planned_inserts -lt 0 -or $summary.planned_inserts -gt 3*$summary.eligible_doctors -or
      $summary.slots_per_doctor -ne 3 -or $summary.executed -isnot [bool] -or $summary.executed -ne $Write -or
      $summary.plan_fingerprint -isnot [string] -or $summary.plan_fingerprint -cnotmatch '^[a-f0-9]{32}$' -or
      $summary.protected_rows_unchanged -isnot [bool] -or $summary.protected_rows_unchanged -ne $true -or $summary.overlaps -ne 0) {
    throw 'Unexpected seed summary; refusing further execution.'
  }
  return $summary
}
try {
  $preview = Invoke-SeedQuery $false ''
  $preview | ConvertTo-Json -Depth 5 | Write-Output
  if (-not $Execute) { Write-Output 'PREVIEW ONLY: no availability inserted.'; return }
  if (-not $Confirmation) { $Confirmation = Read-Host 'Type SEED STAGING DOCTOR AVAILABILITY to confirm' }
  if ($Confirmation -cne 'SEED STAGING DOCTOR AVAILABILITY') { throw 'Confirmation mismatch; no seed executed.' }
  Assert-StagingCleanupProject (Get-Content 'supabase/.temp/project-ref' -Raw)
  $result = Invoke-SeedQuery $true $preview.plan_fingerprint
  if ($result.inserted -ne $preview.planned_inserts -or $result.verified_future_available_slots -ne 3*$preview.eligible_doctors) { throw 'Unexpected execution verification.' }
  $result | ConvertTo-Json -Depth 5 | Write-Output
} finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
