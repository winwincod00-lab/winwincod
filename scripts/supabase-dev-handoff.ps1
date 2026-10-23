# PowerShell 7+. Dot-sourcing defines functions only; never starts a child.
. (Join-Path $PSScriptRoot 'supabase-dev-connection.ps1')
function New-RehearsalEnvironment {
    param([hashtable]$Pins, [Security.SecureString]$Password)
    $required = @('HostName','Port','Database','ProjectRef','ProjectVerified','Method','TargetVerified','SecurityVerified','DeployApproval','FirstApproval')
    foreach ($key in $required) { if (-not $Pins[$key]) { throw 'Missing independently verified configuration.' } }
    $username=Get-RehearsalIdentity -Pins $Pins
    if ($Pins.DeployApproval -cne 'D2-B-EXPLICITLY-APPROVED' -or $Pins.FirstApproval -cne 'FIRST-REHEARSAL-EXPLICITLY-APPROVED') { throw 'Deployment approval required.' }
    $ptr = [IntPtr]::Zero
    try {
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        if (-not $plain -or $plain.Length -gt 4096 -or $plain -match '[\x00-\x1f\x7f]') { throw 'Invalid credential.' }
        $uri = 'postgresql://' + $username + ':' + [Uri]::EscapeDataString($plain) + '@' + $Pins.HostName + ':5432/' + [Uri]::EscapeDataString($Pins.Database) + '?schema=winwincod_dev&sslmode=verify-full&sslaccept=strict&sslcert=' + [Uri]::EscapeDataString($Pins.CaPath)
        $result = @{
            WINWINCOD_SUPABASE_DEV_DATABASE_URL=$uri; WINWINCOD_SUPABASE_DEV_DIRECT_URL=$uri
            WINWINCOD_DEV_TARGET_ALIAS='winwincod-rehearsal'; WINWINCOD_DEV_PROJECT_REF=$Pins.ProjectRef
            WINWINCOD_DEV_PROJECT_VERIFIED=$Pins.ProjectVerified; WINWINCOD_DEV_CONNECTION_METHOD=$Pins.Method
            WINWINCOD_DEV_APPROVED_HOST=$Pins.HostName; WINWINCOD_DEV_APPROVED_PORT='5432'
            WINWINCOD_DEV_APPROVED_DATABASE_PATH=('/'+[Uri]::EscapeDataString($Pins.Database)); WINWINCOD_DEV_APPROVED_USERNAME=$username
            WINWINCOD_DEV_CA_PATH=$Pins.CaPath; WINWINCOD_DEV_CA_SHA256=$Pins.CaSha256; WINWINCOD_DEV_CA_VERIFIED=$Pins.CaVerified
            WINWINCOD_DEV_APPROVED_SHA256='9c369f893753c8cb01d2e3416bbe966bee5bf3ccf61d21bfff2dc44e4be95357'
            WINWINCOD_DEV_TARGET_VERIFIED=$Pins.TargetVerified; WINWINCOD_DEV_SECURITY_VERIFIED=$Pins.SecurityVerified
            WINWINCOD_DEV_HISTORY_PLACEMENT_VERIFIED='false'; WINWINCOD_DEV_DEPLOY_APPROVAL=$Pins.DeployApproval
            WINWINCOD_DEV_FIRST_REHEARSAL_APPROVAL=$Pins.FirstApproval
        }
        return $result
    } finally {
        if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
        $plain=$null; $uri=$null
    }
}
function Invoke-RehearsalHandoff {
    param([hashtable]$Pins, [Security.SecureString]$Password, [scriptblock]$ChildRunner)
    $childEnv=$null; $start=$null
    try {
        foreach ($key in @('DATABASE_URL','DIRECT_URL','NODE_OPTIONS')) { if (Test-Path "Env:$key") { throw 'Inherited runtime configuration rejected.' } }
        $childEnv=New-RehearsalEnvironment -Pins $Pins -Password $Password
        if ($ChildRunner) { & $ChildRunner $childEnv; return }
        $node=(Get-Command node -CommandType Application -ErrorAction Stop).Source
        $start=[Diagnostics.ProcessStartInfo]::new($node)
        $start.UseShellExecute=$false
        $start.ArgumentList.Add((Join-Path $PSScriptRoot 'supabase-dev-deploy.mjs'))
        $start.Environment.Clear()
        foreach ($key in @('SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE')) { $value=[Environment]::GetEnvironmentVariable($key); if ($value) { $start.Environment[$key]=$value } }
        foreach ($key in $childEnv.Keys) { $start.Environment[$key]=$childEnv[$key] }
        $process=[Diagnostics.Process]::Start($start)
        try { $process.WaitForExit(); if ($process.ExitCode -ne 0) { throw 'Child failed; stop without retry.' } } finally { $process.Dispose() }
    } catch { throw 'Handoff rejected or failed; details withheld. Do not retry automatically.' }
    finally {
        if ($childEnv) { $childEnv.Clear() }; if ($start) { $start.Environment.Clear() }
        if ($Password) { $Password.Dispose() }
    }
}
if ($MyInvocation.InvocationName -ne '.') {
    try {
        $pins=Get-RehearsalPromptPins
        foreach ($key in @('DeployApproval','FirstApproval')) {
            $pins[$key]=Read-Host "Privately verified $key (no URI)"
        }
        $password=Read-Host 'Temporary migrator password' -AsSecureString
        Invoke-RehearsalHandoff -Pins $pins -Password $password
    } catch { Write-Error 'Handoff blocked or failed. No automatic retry.'; exit 1 }
}
