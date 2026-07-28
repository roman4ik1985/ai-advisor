function Invoke-AgentOsLoggedCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$CommandText,
        [Parameter(Mandatory)][string]$OutputDirectory,
        [Parameter(Mandatory)][string]$TaskId
    )

    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $timestamp = [DateTimeOffset]::Now.ToString("yyyyMMdd-HHmmss")
    $logPath = Join-Path $OutputDirectory "$TaskId-$Name-$timestamp.log"

    Push-Location $RepositoryRoot
    try {
        $psi = [System.Diagnostics.ProcessStartInfo]::new()
        $psi.FileName = "powershell.exe"
        $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"$CommandText`""
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.WorkingDirectory = $RepositoryRoot

        $proc = [System.Diagnostics.Process]::Start($psi)
        $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
        $stderrTask = $proc.StandardError.ReadToEndAsync()

        if (-not $proc.WaitForExit(30000)) {
            $proc.Kill()
            $proc.WaitForExit()
            $stdout = $stdoutTask.Result
            $stderr = $stderrTask.Result + "`n[TIMEOUT: process exceeded 30s]"
            $exitCode = -1
        } else {
            $stdout = $stdoutTask.Result
            $stderr = $stderrTask.Result
            $exitCode = $proc.ExitCode
        }

        $output = $stdout
        if ($stderr) { $output += "`n$stderr" }
        $output | Set-Content -Path $logPath -Encoding UTF8
        $output | Out-Host
    }
    finally {
        Pop-Location
    }

    [pscustomobject]@{
        Name      = $Name
        Command   = $CommandText
        ExitCode  = $exitCode
        Status    = if ($exitCode -eq 0) { "PASSED" } else { "FAILED" }
        LogPath   = $logPath
    }
}
