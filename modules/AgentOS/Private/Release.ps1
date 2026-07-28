function Get-AgentOsCanonicalReleaseHash {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    $text = $utf8.GetString([System.IO.File]::ReadAllBytes($Path))
    $canonicalText = $text.Replace("`r`n", "`n").Replace("`r", "`n")
    $bytes = $utf8.GetBytes($canonicalText)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        [pscustomobject]@{
            Hash = ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
            Length = $bytes.Length
        }
    }
    finally {
        $sha.Dispose()
    }
}
