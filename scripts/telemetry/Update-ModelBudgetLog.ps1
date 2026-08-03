[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [switch]$Rebuild,
  [ValidateSet('unavailable','prepare','implement','verify')][string]$Stage = 'unavailable',
  [ValidateSet('unavailable','solo','subagent')][string]$ExecutionMode = 'unavailable'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Telemetry.Common.psm1') -Force
$p = Initialize-TelemetryDirectories -ProjectRoot $ProjectRoot

function Convert-OtelValue($value) {
  if ($null -eq $value) { return $null }
  foreach ($name in @('stringValue','intValue','doubleValue','boolValue','bytesValue')) {
    if ($value.PSObject.Properties.Name -contains $name) { return $value.$name }
  }
  if ($value.PSObject.Properties.Name -contains 'arrayValue') { return @($value.arrayValue.values | ForEach-Object { Convert-OtelValue $_ }) }
  if ($value.PSObject.Properties.Name -contains 'kvlistValue') {
    $o = [ordered]@{}; foreach($kv in @($value.kvlistValue.values)){ $o[$kv.key] = Convert-OtelValue $kv.value }; return [pscustomobject]$o
  }
  return $value
}

function Get-Attributes($node) {
  $map = [ordered]@{}
  foreach ($a in @($node.attributes)) { if ($a.key) { $map[$a.key] = Convert-OtelValue $a.value } }
  return $map
}

function Find-FirstValue($root, [string[]]$names) {
  $queue = [Collections.Queue]::new(); $queue.Enqueue($root)
  while($queue.Count -gt 0) {
    $n = $queue.Dequeue(); if ($null -eq $n) { continue }
    if ($n -is [Collections.IDictionary]) { foreach($k in $n.Keys){ if($names -contains [string]$k){ return $n[$k] }; $queue.Enqueue($n[$k]) }; continue }
    if (($n -is [Collections.IEnumerable]) -and -not ($n -is [string])) { foreach($x in $n){ $queue.Enqueue($x) }; continue }
    foreach($prop in $n.PSObject.Properties) { if($names -contains $prop.Name){ return Convert-OtelValue $prop.Value }; $queue.Enqueue($prop.Value) }
    $attrs = Get-Attributes $n
    foreach($name in $names){ if($attrs.Contains($name)){ return $attrs[$name] } }
  }
  return $null
}

function Get-Hash([string]$text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

$files = Get-ChildItem -LiteralPath $p.Raw -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^codex-(logs|traces|metrics)(?:-[^.]+)?\.jsonl(?:\.\d+)?$' } | Sort-Object FullName
$existing = @{}
if (-not $Rebuild -and (Test-Path $p.Normalized)) {
  foreach($line in Get-Content -LiteralPath $p.Normalized) { if($line.Trim()){ try { $r=$line|ConvertFrom-Json; $existing[$r.event_fingerprint]=$true } catch {} } }
}
$records = [Collections.Generic.List[object]]::new()
$errors = [Collections.Generic.List[object]]::new()
foreach($file in $files) {
  $signal = if ($file.Name -match '^codex-(logs|traces|metrics)') { $Matches[1] } else { throw "Unexpected telemetry filename: $($file.Name)" }
  $lineNo = 0
  foreach($line in Get-Content -LiteralPath $file.FullName) {
    $lineNo++; if(-not $line.Trim()){continue}
    try {
      $json = $line | ConvertFrom-Json -Depth 100
      # Rotation renames a file after records have already been normalized. The
      # signal plus payload is stable across that rename, unlike the filename.
      $fingerprint = Get-Hash "$signal|$line"
      if($existing.ContainsKey($fingerprint)){continue}
      $input = Find-FirstValue $json @('input_tokens','inputTokens','gen_ai.usage.input_tokens')
      $cached = Find-FirstValue $json @('cached_input_tokens','cachedInputTokens','gen_ai.usage.cached_tokens')
      $output = Find-FirstValue $json @('output_tokens','outputTokens','gen_ai.usage.output_tokens')
      $reasoning = Find-FirstValue $json @('reasoning_tokens','reasoningTokens')
      $duration = Find-FirstValue $json @('duration_ms','durationMs','gen_ai.client.operation.duration')
      $model = Find-FirstValue $json @('model','gen_ai.request.model','gen_ai.response.model')
      $effort = Find-FirstValue $json @('reasoning_effort','reasoning.effort','effort')
      $conversation = Find-FirstValue $json @('conversation_id','conversationId','session.id')
      $turn = Find-FirstValue $json @('turn_id','turnId')
      $timestamp = Find-FirstValue $json @('timeUnixNano','startTimeUnixNano','timestamp')
      $record = [ordered]@{
        timestamp_utc = if($timestamp){[string]$timestamp}else{$null}; conversation_id=$conversation; turn_id=$turn
        stage=$Stage; execution_mode=$ExecutionMode; model=$model; model_evidence=if($model){'measured'}else{'unavailable'}
        effort=$effort; effort_evidence=if($effort){'measured'}else{'unavailable'}; speed=$null; speed_evidence='unavailable'
        input_tokens=$input; cached_input_tokens=$cached; output_tokens=$output; reasoning_tokens=$reasoning
        total_tokens=if($null-ne$input -and $null-ne$output){[int64]$input+[int64]$output}else{$null}
        token_evidence=if($null-ne$input -or $null-ne$output -or $null-ne$reasoning){'measured'}else{'unavailable'}
        tool_calls=$null; tool_failures=$null; duration_ms=$duration; duration_evidence=if($null-ne$duration){'measured'}else{'unavailable'}
        sandbox_mode=(Find-FirstValue $json @('sandbox_mode','sandbox')); approval_policy=(Find-FirstValue $json @('approval_policy','approval'))
        result='unknown'; error_type=$null; weekly_budget_pct=$null; budget_evidence='unavailable'; calibration_id=$null; calibration_confidence=$null
        similarity_key=$null; source_files=@($file.Name); schema_version=1; event_fingerprint=$fingerprint
      }
      $records.Add([pscustomobject]$record); $existing[$fingerprint]=$true
    } catch { $errors.Add([pscustomobject]@{ file=$file.Name; line=$lineNo; error=$_.Exception.Message }) }
  }
}
$all = [Collections.Generic.List[object]]::new()
if(-not $Rebuild -and (Test-Path $p.Normalized)){ foreach($line in Get-Content $p.Normalized){if($line.Trim()){try{$all.Add(($line|ConvertFrom-Json -Depth 100))}catch{}}} }
foreach($r in $records){$all.Add($r)}
$normalizedText = (($all | ForEach-Object { $_ | ConvertTo-Json -Depth 20 -Compress }) -join "`n")
if($normalizedText){$normalizedText += "`n"}
$generated = (Get-Date).ToUniversalTime().ToString('o')
$md = [Collections.Generic.List[string]]::new()
$md.Add('# Model Budget Telemetry Log'); $md.Add(''); $md.Add("Generated UTC: $generated"); $md.Add('');
$md.Add('Evidence: measured=direct telemetry; configured=active settings; estimated=calibration; unavailable=no reliable value.');
$md.Add('`weekly_budget_pct` is never measured by this pipeline and remains unavailable unless a documented calibration is supplied.'); $md.Add('')
$md.Add('| Timestamp | Conversation | Model | Input | Output | Duration ms | Budget evidence |'); $md.Add('|---|---|---|---:|---:|---:|---|')
foreach($r in $all){$md.Add("| $($r.timestamp_utc) | $($r.conversation_id) | $($r.model) | $($r.input_tokens) | $($r.output_tokens) | $($r.duration_ms) | $($r.budget_evidence) |")}
$state = [ordered]@{ schema_version=1; updated_at_utc=$generated; processed_records=$all.Count; new_records=$records.Count; parse_errors=$errors; formal_acceptance='NOT_RUN' } | ConvertTo-Json -Depth 10
if($PSCmdlet.ShouldProcess($p.Normalized,'Write normalized telemetry')){Write-AtomicUtf8 $p.Normalized $normalizedText; Write-AtomicUtf8 $p.BudgetLog (($md-join "`r`n")+"`r`n"); Write-AtomicUtf8 $p.State $state}
[pscustomobject]@{ NewRecords=$records.Count; TotalRecords=$all.Count; ParseErrors=$errors.Count; Normalized=$p.Normalized; BudgetLog=$p.BudgetLog; FormalAcceptance='NOT_RUN' }
