$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../staging-appointment-cleanup-guards.ps1')
$main=Join-Path $PSScriptRoot '../seed-staging-doctor-future-availability.ps1'
function Assert-True($Condition) { if(-not $Condition){throw 'Seed test failed'} }
function Reject([scriptblock]$Action) { $rejected=$false;try{& $Action | Out-Null}catch{$rejected=$true};Assert-True $rejected }
Reject { Assert-StagingCleanupProject 'production' }
Reject { Assert-StagingCleanupProject '' }
$global:SeedCalls=@()
function global:node {
  $arguments=@($args);$index=[Array]::IndexOf($arguments,'--file')
  if($index -lt 0 -or $arguments -notcontains 'xyprybspwrtthvhnumdp'){throw 'Unexpected mock command'}
  $query=Get-Content -LiteralPath $arguments[$index+1] -Raw
  $write=$query.Contains('execute_seed boolean := true')
  $global:SeedCalls+= $query
  $global:LASTEXITCODE=0
  [pscustomobject]@{boundary='test';warning='test';rows=@([pscustomobject]@{summary=[pscustomobject]@{
    eligible_doctors=2;planned_inserts=6;slots_per_doctor=3;executed=$write;plan_fingerprint=('a'*32);
    protected_rows_unchanged=$true;overlaps=0;inserted=$(if($write){6}else{0});verified_future_available_slots=$(if($write){6}else{0})
  }})} | ConvertTo-Json -Depth 5
}
try {
  Assert-True ((Get-Command node).CommandType -eq 'Function')
  & $main | Out-Null;Assert-True ($global:SeedCalls.Count -eq 1)
  $global:SeedCalls=@();Reject { & $main -Execute -Confirmation 'wrong' };Assert-True ($global:SeedCalls.Count -eq 1)
  $global:SeedCalls=@();& $main -Execute -Confirmation 'SEED STAGING DOCTOR AVAILABILITY' | Out-Null
  Assert-True ($global:SeedCalls.Count -eq 2)
  Assert-True ($global:SeedCalls[1].Contains("fingerprint<>'"+('a'*32)+"'"))
} finally {
  Remove-Item -LiteralPath 'Function:global:node' -ErrorAction SilentlyContinue
  Remove-Variable SeedCalls -Scope Global -ErrorAction SilentlyContinue
}
Write-Output 'PASS: 6 PowerShell project/preview/confirmation/fingerprint checks; CLI fully mocked.'
