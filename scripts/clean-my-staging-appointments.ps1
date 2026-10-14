# Defaults to a read-only preview. Never run automatically.
param([string]$Account, [switch]$Execute)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'staging-appointment-cleanup-guards.ps1')
$stageProject = 'xyprybspwrtthvhnumdp'
Assert-StagingCleanupProject (Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw)
if (-not $Account) { $Account = Read-Host 'Exact sign-in email or stored patient phone (never a password/token)' }
if (-not $Account.Trim()) { throw 'A specific account is required.' }
$template = Get-Content -LiteralPath 'scripts/clean-my-staging-appointments.sql' -Raw
$accountHex = [BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes($Account.Trim())).Replace('-', '').ToLowerInvariant()
$tempSql = Join-Path ([IO.Path]::GetTempPath()) ("easycare-cleanup-" + [guid]::NewGuid().ToString('N') + '.sql')
try {
  $previewSql = $template.Replace('__ACCOUNT_HEX__', $accountHex).Replace('__EXECUTE__', 'false').Replace('__EXPECTED_PLAN__', '')
  [IO.File]::WriteAllText($tempSql, $previewSql)
  $preview = (& node node_modules/supabase/dist/supabase.js db query --linked --project-ref $stageProject --output json --output-format json --file $tempSql | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'Preview failed. No cleanup was executed.' }
  $plan = ConvertFrom-CleanupPreview $preview
  Write-Output ($plan | ConvertTo-Json -Depth 10)
  if (-not $Execute) { Write-Output 'PREVIEW ONLY: no appointments or availability were changed.'; return }
  Assert-CleanupExecutablePlan $plan
  Assert-CleanupConfirmation (Read-Host 'Review the counts above. Type DELETE MY STAGING APPOINTMENTS to confirm permanent cleanup')
  Assert-StagingCleanupProject (Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw)
  $executeSql = $template.Replace('__ACCOUNT_HEX__', $accountHex).Replace('__EXECUTE__', 'true').Replace('__EXPECTED_PLAN__', $plan.plan_fingerprint)
  [IO.File]::WriteAllText($tempSql, $executeSql)
  & node node_modules/supabase/dist/supabase.js db query --linked --project-ref $stageProject --output json --output-format json --file $tempSql
  if ($LASTEXITCODE -ne 0) { throw 'Cleanup failed; inspect the reported transaction error before retrying.' }
} finally {
  if (Test-Path -LiteralPath $tempSql) { Remove-Item -LiteralPath $tempSql }
}
