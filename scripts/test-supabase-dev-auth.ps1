$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'supabase-dev-auth.ps1')
. (Join-Path $PSScriptRoot 'test-supabase-dev-fixture.ps1')
$pins=New-RehearsalTestPins
$approval='AUTH-ONLY-EXPLICITLY-APPROVED'
function Assert-Rejected {
    param([scriptblock]$Action)
    $rejected=$false
    try { & $Action | Out-Null } catch { $rejected=$true }
    if (-not $rejected) { throw 'Expected rejection missing.' }
}
try {
    $poison=@{PGPASSWORD='synthetic-not-a-real-password'; PGSERVICE='wrong'; PGSERVICEFILE='wrong'; PGHOST='wrong';
        PGOPTIONS='-c search_path=public'; DATABASE_URL='synthetic'; NODE_OPTIONS='synthetic'}
    $saved=@{}
    foreach ($key in $poison.Keys) { $saved[$key]=[Environment]::GetEnvironmentVariable($key); [Environment]::SetEnvironmentVariable($key,$poison[$key]) }
    try {
    $pool=$pins.Clone(); $pool.Method='session-pooler'; $pool.HostName='aws-0-eu-west-1.pooler.supabase.com'; $pool.Database='postgres'
    foreach ($candidate in @($pins,$pool)) {
        $plan=New-RehearsalAuthPlan -Pins $candidate -Approval $approval
        try {
            if ($plan.FileName -cne 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -or $plan.UseShellExecute -or
                -not $plan.RedirectStandardOutput -or $plan.RedirectStandardError -or $plan.RedirectStandardInput) { throw 'Unsafe process configuration.' }
            if ($plan.Environment.ContainsKey('PGPASSWORD') -or $plan.Environment.ContainsKey('DATABASE_URL') -or
                $plan.Environment.ContainsKey('PGSERVICE') -or $plan.Environment.ContainsKey('PGSERVICEFILE') -or
                $plan.Environment.ContainsKey('NODE_OPTIONS') -or $plan.Environment['PGPASSFILE'] -cne 'NUL') { throw 'Inherited configuration leaked.' }
            if ($plan.Environment['PGSSLMODE'] -cne 'verify-full' -or $plan.Environment['PGSSLROOTCERT'] -cne $pins.CaPath -or
                $plan.Environment['PGPORT'] -cne '5432' -or $plan.Environment['PGOPTIONS'] -notmatch '^\-c search_path=winwincod_dev ') { throw 'TLS/search path failure.' }
            $expected=if ($candidate.Method -ceq 'session-pooler') { 'winwincod_dev_migrator.abcdefghijklmnopqrst' } else { 'winwincod_dev_migrator' }
            if ($plan.Environment['PGUSER'] -cne $expected -or $plan.Environment['PGHOST'] -cne $candidate.HostName) { throw 'Wrong identity.' }
            $args=@($plan.ArgumentList)
            if (($args | Where-Object { $_ -ceq '--command' }).Count -ne 1 -or
                $args[-1] -cne 'SELECT current_user, session_user, current_database(), current_schema();' -or
                $args -cnotcontains '-W' -or $args -cnotcontains '-X' -or $args -match 'migrate|deploy|--file|--no-password') { throw 'Wrong command allowlist.' }
        } finally { $plan.Environment.Clear() }
    }
    foreach ($key in $poison.Keys) {
        if ([Environment]::GetEnvironmentVariable($key) -cne $poison[$key]) { throw 'Parent environment modified.' }
    }
    } finally { foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key]) } }
    Assert-Rejected { New-RehearsalAuthPlan -Pins $pool -Approval '' }
    Assert-Rejected { New-RehearsalAuthPlan -Pins $pool -Approval 'D2-B-EXPLICITLY-APPROVED' }
    foreach ($key in @('ProjectRef','ProjectVerified','TargetVerified','SecurityVerified','CaPath','CaSha256','CaVerified','HostName','Method','Database','Port')) {
        $bad=$pool.Clone(); $bad.Remove($key)
        Assert-Rejected { New-RehearsalAuthPlan -Pins $bad -Approval $approval }
    }
    foreach ($patch in @(@{Port='6543'},@{Method='transaction-pooler'},@{HostName='aws-1-eu-west-1.pooler.supabase.com'},
        @{Database='other'},@{CaPath='relative.pem'},@{CaSha256=('0'*64)},@{CaVerified='True'},@{ProjectVerified='True'},@{ProjectRef='bad.ref'})) {
        $bad=$pool.Clone(); foreach ($key in $patch.Keys) { $bad[$key]=$patch[$key] }
        Assert-Rejected { New-RehearsalAuthPlan -Pins $bad -Approval $approval }
    }
    Assert-RehearsalAuthResult -ExitCode 0 -Output "winwincod_dev_migrator,winwincod_dev_migrator,postgres,winwincod_dev`r`n" -Database postgres
    foreach ($result in @('postgres,postgres,postgres,winwincod_dev', 'winwincod_dev_migrator,postgres,postgres,winwincod_dev',
        'winwincod_dev_migrator,winwincod_dev_migrator,other,winwincod_dev', 'winwincod_dev_migrator,winwincod_dev_migrator,postgres,public',
        "winwincod_dev_migrator,winwincod_dev_migrator,postgres,winwincod_dev`nextra")) {
        Assert-Rejected { Assert-RehearsalAuthResult -ExitCode 0 -Output $result -Database postgres }
    }
    Assert-Rejected { Assert-RehearsalAuthResult -ExitCode 1 -Output 'anything' -Database postgres }
    # Matching digest alone must not make a malformed file a trusted CA.
    [IO.File]::WriteAllText($pins.CaPath,'not a certificate')
    $bad=$pool.Clone(); $bad.CaSha256=(Get-FileHash -LiteralPath $pins.CaPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Rejected { New-RehearsalAuthPlan -Pins $bad -Approval $approval }
    Write-Output 'Authentication plan tests passed: exact query/result, isolated environment, hidden password flags, pinned identities, CA/approval/method rejection. No child process started.'
} finally { Remove-RehearsalTestPins -Pins $pins }
