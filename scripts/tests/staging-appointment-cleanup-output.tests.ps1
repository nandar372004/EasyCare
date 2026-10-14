# Local PowerShell contract tests. The CLI and confirmation prompt are mocked.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../staging-appointment-cleanup-guards.ps1')
$mainScript = Join-Path $PSScriptRoot '../clean-my-staging-appointments.ps1'
$script:passed = 0
function Assert-True($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Expect-Rejection([scriptblock]$Action) {
  $rejected = $false
  try { & $Action | Out-Null } catch { $rejected = $true }
  Assert-True $rejected 'Expected a fail-closed rejection.'
  $script:passed++
}
function New-TestPreview {
  return [pscustomobject]@{ boundary = 'fixture-boundary'; warning = 'fixture-warning'; rows = @([pscustomobject]@{ summary = [pscustomobject]@{
    total=3; pending=3; confirmed=0; cancelled=0; completed=0; no_show=0; rescheduled=0;
    linked_booked_slots=3; shared_slot_reservations=0; blocked=$false; dependencies=[pscustomobject]@{};
    patient_reference='patient-1234abcd'; plan_fingerprint=('a' * 32); executed=$false; appointments_deleted=0; slots_restored=0
  } }) }
}
$preview = New-TestPreview
$parsed = ConvertFrom-CleanupPreview ($preview | ConvertTo-Json -Depth 10)
Assert-True ($parsed.total -eq 3 -and $parsed.plan_fingerprint -eq ('a' * 32)) 'Valid JSON preview did not parse.'
$script:passed++
$zero = New-TestPreview; $zero.rows = @()
Expect-Rejection { ConvertFrom-CleanupPreview ($zero | ConvertTo-Json -Depth 10) }
$two = New-TestPreview; $two.rows = @($two.rows[0], $two.rows[0])
Expect-Rejection { ConvertFrom-CleanupPreview ($two | ConvertTo-Json -Depth 10) }
$noSummary = New-TestPreview; $noSummary.rows = @([pscustomobject]@{ other = 'unexpected' })
Expect-Rejection { ConvertFrom-CleanupPreview ($noSummary | ConvertTo-Json -Depth 10) }
$badSummary = New-TestPreview; $badSummary.rows[0].summary = 'not an object'
Expect-Rejection { ConvertFrom-CleanupPreview ($badSummary | ConvertTo-Json -Depth 10) }
$invalidFingerprint = New-TestPreview; $invalidFingerprint.rows[0].summary.plan_fingerprint = 'invalid'
Expect-Rejection { ConvertFrom-CleanupPreview ($invalidFingerprint | ConvertTo-Json -Depth 10) }
$executed = New-TestPreview; $executed.rows[0].summary.executed = $true
Expect-Rejection { ConvertFrom-CleanupPreview ($executed | ConvertTo-Json -Depth 10) }
$extraResults = New-TestPreview; $extraResults | Add-Member -NotePropertyName results -NotePropertyValue @()
Expect-Rejection { ConvertFrom-CleanupPreview ($extraResults | ConvertTo-Json -Depth 10) }
$objectRows = New-TestPreview; $objectRows.rows = $objectRows.rows[0]
Expect-Rejection { ConvertFrom-CleanupPreview ($objectRows | ConvertTo-Json -Depth 10) }
Expect-Rejection { ConvertFrom-CleanupPreview '[{"summary":{}}]' }
$negative = New-TestPreview; $negative.rows[0].summary.total = -1
Expect-Rejection { ConvertFrom-CleanupPreview ($negative | ConvertTo-Json -Depth 10) }
Expect-Rejection { ConvertFrom-CleanupPreview 'map[total:3 blocked:false]' }
Expect-Rejection { ConvertFrom-CleanupPreview '{broken' }
$missing = New-TestPreview; $missing.rows[0].summary.PSObject.Properties.Remove('plan_fingerprint')
Expect-Rejection { ConvertFrom-CleanupPreview ($missing | ConvertTo-Json -Depth 10) }
$blocked = New-TestPreview; $blocked.rows[0].summary.blocked = $true
Expect-Rejection { Assert-CleanupExecutablePlan (ConvertFrom-CleanupPreview ($blocked | ConvertTo-Json -Depth 10)) }
$shared = New-TestPreview; $shared.rows[0].summary.shared_slot_reservations = 1
Expect-Rejection { Assert-CleanupExecutablePlan (ConvertFrom-CleanupPreview ($shared | ConvertTo-Json -Depth 10)) }
$badFlag = New-TestPreview; $badFlag.rows[0].summary.blocked = 'false'
Expect-Rejection { ConvertFrom-CleanupPreview ($badFlag | ConvertTo-Json -Depth 10) }
Expect-Rejection { Assert-CleanupConfirmation 'delete my staging appointments' }
Expect-Rejection { Assert-StagingCleanupProject 'production-project' }
Expect-Rejection { Assert-StagingCleanupProject '' }

# Global mocks ensure invocation cannot reach the actual node/Supabase executable.
$global:CleanupMockCalls = @()
$global:CleanupMockJson = $preview | ConvertTo-Json -Depth 10
$global:CleanupMockConfirmation = 'DELETE MY STAGING APPOINTMENTS'
function global:node {
  $arguments = @($args)
  $fileIndex = [Array]::IndexOf($arguments, '--file')
  if ($fileIndex -lt 0) { throw 'Unexpected command in CLI mock.' }
  $sql = Get-Content -LiteralPath $arguments[$fileIndex + 1] -Raw
  $global:CleanupMockCalls += [pscustomobject]@{ Arguments=$arguments; Sql=$sql }
  $global:LASTEXITCODE = 0
  return $global:CleanupMockJson
}
function global:Read-Host { param($Prompt); return $global:CleanupMockConfirmation }
try {
  Assert-True ((Get-Command node).CommandType -eq 'Function') 'CLI mock is not installed; refusing tests.'
  & $mainScript -Account 'synthetic@example.test' | Out-Null
  Assert-True ($global:CleanupMockCalls.Count -eq 1) 'Preview invoked execution.'
  $script:passed++
  $global:CleanupMockCalls = @()
  & $mainScript -Account 'synthetic@example.test' -Execute | Out-Null
  Assert-True ($global:CleanupMockCalls.Count -eq 2) 'Mock execution path did not issue preview then execution.'
  foreach ($call in $global:CleanupMockCalls) {
    Assert-True ($call.Arguments -contains '--output' -and $call.Arguments -contains '--output-format') 'Machine-readable flags missing.'
    Assert-True ($call.Arguments -contains 'xyprybspwrtthvhnumdp') 'Explicit Staging ref missing.'
  }
  Assert-True ($global:CleanupMockCalls[0].Sql.Contains('execute_cleanup boolean := false')) 'First call was not preview.'
  Assert-True ($global:CleanupMockCalls[1].Sql.Contains('execute_cleanup boolean := true')) 'Execution switch missing.'
  Assert-True ($global:CleanupMockCalls[1].Sql.Contains("fingerprint <> '" + ('a' * 32) + "'")) 'Preview fingerprint was not propagated.'
  $script:passed++
  $global:CleanupMockCalls = @(); $global:CleanupMockConfirmation = 'wrong confirmation'
  Expect-Rejection { & $mainScript -Account 'synthetic@example.test' -Execute }
  Assert-True ($global:CleanupMockCalls.Count -eq 1) 'Wrong confirmation reached execution.'
  $global:CleanupMockCalls = @(); $global:CleanupMockJson = $blocked | ConvertTo-Json -Depth 10
  Expect-Rejection { & $mainScript -Account 'synthetic@example.test' -Execute }
  Assert-True ($global:CleanupMockCalls.Count -eq 1) 'Blocked preview reached execution.'
} finally {
  Remove-Item -LiteralPath 'Function:global:node' -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath 'Function:global:Read-Host' -ErrorAction SilentlyContinue
  Remove-Variable -Name CleanupMockCalls,CleanupMockJson,CleanupMockConfirmation -Scope Global -ErrorAction SilentlyContinue
}
Write-Output "PASS: $script:passed PowerShell output/guard checks; all CLI calls mocked; no live cleanup."
