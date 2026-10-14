$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$taskBranch = 'refs/heads/codex/staging-notification-scheduler'
$taskIndex = Join-Path $PSScriptRoot 'staging-reminder-publish.index'
$taskMessage = Join-Path $PSScriptRoot 'staging-reminder-commit-message.txt'
$taskOriginalIndex = $env:GIT_INDEX_FILE
try {
  git fetch origin main
  if ($LASTEXITCODE -ne 0) { throw 'Remote main refresh failed.' }
  $taskParent = (git rev-parse refs/remotes/origin/main).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve remote main.' }
  $env:GIT_INDEX_FILE = $taskIndex
  git read-tree $taskParent
  if ($LASTEXITCODE -ne 0) { throw 'Cannot initialize isolated index.' }
  git add -- .github/workflows/patient-notification-reminders.yml supabase/scripts/run-notification-reminders.mjs src/lib/notificationReminderRunner.test.js
  if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare scheduler files.' }
  $taskFiles = @(git diff --cached --name-only $taskParent)
  $taskExpected = @('.github/workflows/patient-notification-reminders.yml','src/lib/notificationReminderRunner.test.js','supabase/scripts/run-notification-reminders.mjs')
  if (@(Compare-Object $taskExpected $taskFiles).Count -ne 0) { throw 'Unexpected files in isolated commit.' }
  git diff --cached --check
  if ($LASTEXITCODE -ne 0) { throw 'Scheduler whitespace check failed.' }
  $taskTree = (git write-tree).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot write scheduler tree.' }
  Set-Content -LiteralPath $taskMessage -Value 'Add Staging-only patient notification reminder scheduler' -Encoding utf8
  $taskCommit = (git -c user.name=Codex -c user.email=codex@openai.com commit-tree $taskTree -p $taskParent -F $taskMessage).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot create scheduler commit.' }
  git update-ref $taskBranch $taskCommit '0000000000000000000000000000000000000000'
  if ($LASTEXITCODE -ne 0) { throw 'Cannot create new scheduler branch; existing branch left unchanged.' }
  Write-Output ('Prepared scheduler commit: ' + $taskCommit)
  git diff-tree --no-commit-id --name-only -r $taskCommit
} finally {
  if ($null -eq $taskOriginalIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
  else { $env:GIT_INDEX_FILE = $taskOriginalIndex }
}
