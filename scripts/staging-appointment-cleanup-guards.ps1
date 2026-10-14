# Pure validation helpers. No database calls or mutations.
function Assert-StagingCleanupProject {
  param([string]$ProjectRef)
  if ($ProjectRef.Trim() -cne 'xyprybspwrtthvhnumdp') { throw 'Refusing cleanup: the linked project must be EasyCare Staging.' }
}

function Get-CleanupSqlPreviewRow {
  param([string]$Json)
  try { $result = ConvertFrom-Json -InputObject $Json -ErrorAction Stop }
  catch { throw 'Malformed machine-readable cleanup preview; refusing execution.' }
  # Supabase CLI v2.115.0 JSON envelope. Metadata is never counted as SQL rows.
  if ($result -isnot [pscustomobject]) { throw 'Unexpected CLI JSON envelope; refusing execution.' }
  $keys = @($result.PSObject.Properties.Name)
  if ($keys.Count -ne 3 -or $keys -cnotcontains 'boundary' -or $keys -cnotcontains 'rows' -or $keys -cnotcontains 'warning' -or
      $result.boundary -isnot [string] -or $result.warning -isnot [string]) {
    throw 'Unexpected CLI JSON envelope; refusing execution.'
  }
  if ($result.rows -isnot [array] -or $result.rows.Count -ne 1) { throw 'Expected exactly one preview row; refusing execution.' }
  $row = $result.rows[0]
  if ($row -isnot [pscustomobject] -or @($row.PSObject.Properties).Count -ne 1 -or
      @($row.PSObject.Properties.Name) -cnotcontains 'summary') { throw 'Expected one SQL summary column; refusing execution.' }
  if ($row.summary -isnot [pscustomobject]) { throw 'Expected a structured preview summary; refusing execution.' }
  return $row
}

function ConvertFrom-CleanupPreview {
  param([string]$Json)
  $row = Get-CleanupSqlPreviewRow $Json
  $plan = $row.summary
  if ($plan -isnot [pscustomobject]) { throw 'Expected a structured preview summary; refusing execution.' }
  $countFields = @('total','pending','confirmed','cancelled','completed','no_show','rescheduled','linked_booked_slots','shared_slot_reservations','appointments_deleted','slots_restored')
  foreach ($field in $countFields) {
    $value = $plan.$field
    if (($value -isnot [int] -and $value -isnot [long]) -or $value -lt 0) { throw "Invalid or missing preview count: $field" }
  }
  if ($plan.blocked -isnot [bool] -or $plan.executed -isnot [bool] -or $plan.dependencies -isnot [pscustomobject]) { throw 'Invalid preview flags or dependencies; refusing execution.' }
  if ($plan.executed -or $plan.appointments_deleted -ne 0 -or $plan.slots_restored -ne 0) { throw 'Expected a non-executing preview; refusing execution.' }
  if ($plan.patient_reference -isnot [string] -or $plan.patient_reference -cnotmatch '^patient-[a-f0-9]{8}$') { throw 'Invalid masked patient reference; refusing execution.' }
  if ($plan.plan_fingerprint -isnot [string] -or $plan.plan_fingerprint -cnotmatch '^[a-f0-9]{32}$') { throw 'Invalid or missing preview fingerprint; refusing execution.' }
  $statusTotal = [decimal]$plan.pending + $plan.confirmed + $plan.cancelled + $plan.completed + $plan.no_show + $plan.rescheduled
  if ($statusTotal -ne $plan.total) { throw 'Preview status counts are inconsistent; refusing execution.' }
  return $plan
}

function Assert-CleanupExecutablePlan {
  param($Plan)
  if ($Plan.blocked -or $Plan.shared_slot_reservations -ne 0 -or @($Plan.dependencies.PSObject.Properties).Count -ne 0) {
    throw 'Cleanup is blocked by dependencies or shared reservations.'
  }
}

function Assert-CleanupConfirmation {
  param([string]$Confirmation)
  if ($Confirmation -cne 'DELETE MY STAGING APPOINTMENTS') { throw 'Confirmation did not match. No cleanup executed.' }
}
