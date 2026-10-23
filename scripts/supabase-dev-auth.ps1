# PowerShell 7+. Separate from deployment; dot-sourcing has no live effects.
. (Join-Path $PSScriptRoot 'supabase-dev-connection.ps1')

function New-RehearsalAuthPlan {
    param([hashtable]$Pins, [string]$Approval)
    if ($Approval -cne 'AUTH-ONLY-EXPLICITLY-APPROVED') { throw 'Separate authentication approval required.' }
    $username=Get-RehearsalIdentity -Pins $Pins
    $start=[Diagnostics.ProcessStartInfo]::new('C:\Program Files\PostgreSQL\17\bin\psql.exe')
    $start.UseShellExecute=$false
    $start.RedirectStandardOutput=$true
    # Password prompt stays on the operator console. Never supply a password here.
    $start.Environment.Clear()
    foreach ($key in @('SystemRoot','WINDIR','TEMP','TMP')) {
        $value=[Environment]::GetEnvironmentVariable($key)
        if ($value) { $start.Environment[$key]=$value }
    }
    $values=@{
        PGHOST=$Pins.HostName; PGPORT='5432'; PGDATABASE=$Pins.Database; PGUSER=$username
        PGSSLMODE='verify-full'; PGSSLROOTCERT=$Pins.CaPath; PGCONNECT_TIMEOUT='10'
        PGGSSENCMODE='disable'; PGPASSFILE='NUL'; PSQL_HISTORY='NUL'
        PGOPTIONS='-c search_path=winwincod_dev -c statement_timeout=10000 -c lock_timeout=2000 -c idle_session_timeout=900000'
    }
    foreach ($key in $values.Keys) { $start.Environment[$key]=$values[$key] }
    foreach ($argument in @('-X','-W','--quiet','--csv','--tuples-only','--no-psqlrc','--pset=pager=off','--set=ON_ERROR_STOP=1','--command',
        'SELECT current_user, session_user, current_database(), current_schema();')) { $start.ArgumentList.Add($argument) }
    return $start
}

function Assert-RehearsalAuthResult {
    param([int]$ExitCode, [string]$Output, [string]$Database)
    $expected="winwincod_dev_migrator,winwincod_dev_migrator,$Database,winwincod_dev"
    if ($ExitCode -ne 0 -or $Output.TrimEnd("`r","`n") -cne $expected) { throw 'Authentication identity test failed. Stop without retry.' }
}

function Invoke-RehearsalAuth {
    param([hashtable]$Pins, [string]$Approval)
    $start=$null; $process=$null
    try {
        $start=New-RehearsalAuthPlan -Pins $Pins -Approval $Approval
        if ([Console]::IsInputRedirected) { throw 'Interactive console required.' }
        $process=[Diagnostics.Process]::Start($start)
        $outputTask=$process.StandardOutput.ReadToEndAsync()
        if (-not $process.WaitForExit(900000)) { $process.Kill($true); throw 'Authentication window expired.' }
        Assert-RehearsalAuthResult -ExitCode $process.ExitCode -Output $outputTask.GetAwaiter().GetResult() -Database $Pins.Database
        Write-Output 'Authentication-only identity test passed. Client closed. Administrator must retire the credential.'
    } catch { throw 'Authentication blocked or failed. Stop without retry; administrator must retire the credential.' }
    finally {
        if ($process) {
            try { if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit() } }
            finally { $process.Dispose() }
        }
        if ($start) { $start.Environment.Clear() }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        $pins=Get-RehearsalPromptPins
        $approval=Read-Host 'Separate live approval (AUTH-ONLY-EXPLICITLY-APPROVED)'
        Invoke-RehearsalAuth -Pins $pins -Approval $approval
    } catch { Write-Error 'Authentication blocked or failed. No automatic retry. Administrator must retire the credential.'; exit 1 }
}
