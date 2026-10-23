$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'supabase-dev-handoff.ps1')
. (Join-Path $PSScriptRoot 'test-supabase-dev-fixture.ps1')
$pins=New-RehearsalTestPins
try {
$script:captured=$null
$secret=ConvertTo-SecureString 'synthetic:@/?% value' -AsPlainText -Force
$output=Invoke-RehearsalHandoff -Pins $pins -Password $secret -ChildRunner {
    param($e)
    $script:captured=$e
    $u=[Uri]$e.WINWINCOD_SUPABASE_DEV_DIRECT_URL
    $decoded=[Uri]::UnescapeDataString(($u.UserInfo -split ':',2)[1])
    if ($decoded -cne 'synthetic:@/?% value') { throw 'Encoding failed' }
    if ($e.ContainsKey('DATABASE_URL') -or $e.ContainsKey('DIRECT_URL')) { throw 'Runtime leakage' }
}
if ($output -or $script:captured.Count -ne 0) { throw 'Output/cleanup failure' }
$secret=ConvertTo-SecureString 'synthetic' -AsPlainText -Force
try {
    Invoke-RehearsalHandoff -Pins $pins -Password $secret -ChildRunner { param($e) $script:captured=$e; throw 'synthetic secret MUST NOT ESCAPE' }
    throw 'Expected rejection missing'
} catch {
    if ($_.Exception.Message -cne 'Handoff rejected or failed; details withheld. Do not retry automatically.') { throw 'Unsafe diagnostic' }
}
if ($script:captured.Count -ne 0) { throw 'Failure cleanup missing' }
foreach ($method in @('session-pooler','transaction-pooler')) {
    $candidate=$pins.Clone();$candidate.Method=$method
    $secret=ConvertTo-SecureString 'synthetic' -AsPlainText -Force
    try { Invoke-RehearsalHandoff -Pins $candidate -Password $secret -ChildRunner { throw 'Must not start' }; throw 'Expected rejection missing' }
    catch { if ($_.Exception.Message -cne 'Handoff rejected or failed; details withheld. Do not retry automatically.') { throw } }
}
$pool=$pins.Clone(); $pool.Method='session-pooler'; $pool.HostName='aws-0-eu-west-1.pooler.supabase.com'; $pool.Database='postgres'
$secret=ConvertTo-SecureString 'synthetic' -AsPlainText -Force
Invoke-RehearsalHandoff -Pins $pool -Password $secret -ChildRunner {
    param($e)
    $u=[Uri]$e.WINWINCOD_SUPABASE_DEV_DIRECT_URL
    if (($u.UserInfo -split ':')[0] -cne 'winwincod_dev_migrator.abcdefghijklmnopqrst' -or
        $e.WINWINCOD_DEV_CA_VERIFIED -cne 'true' -or $u.Query -notmatch 'sslaccept=strict&sslcert=') { throw 'Pooler identity/TLS failure' }
}
Write-Output 'PowerShell handoff tests passed: direct/session identity, CA, encoding, sanitized failure, cleanup, invalid method rejection; no child process started.'
} finally { Remove-RehearsalTestPins -Pins $pins }
