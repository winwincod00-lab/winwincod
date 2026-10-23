# Shared offline validation only. No DNS, sockets, SQL, secret loading or child launch.
function Get-RehearsalIdentity {
    param([hashtable]$Pins)
    if ($Pins.ProjectVerified -cne 'true' -or $Pins.TargetVerified -cne 'true' -or
        $Pins.SecurityVerified -cne 'true' -or $Pins.ProjectRef -cnotmatch '^[a-z0-9]{10,64}$' -or
        $Pins.Port -cne '5432') { throw 'Unverified target.' }
    switch -CaseSensitive ($Pins.Method) {
        'direct' {
            if ($Pins.HostName -cne "db.$($Pins.ProjectRef).supabase.co" -or
                $Pins.Database -cnotmatch '^[A-Za-z0-9_-]+$') { throw 'Direct target rejected.' }
            $username='winwincod_dev_migrator'
        }
        'session-pooler' {
            if ($Pins.HostName -cne 'aws-0-eu-west-1.pooler.supabase.com' -or
                $Pins.Database -cne 'postgres') { throw 'Session target rejected.' }
            $username="winwincod_dev_migrator.$($Pins.ProjectRef)"
        }
        default { throw 'Connection method rejected.' }
    }
    if ($Pins.CaVerified -cne 'true' -or $Pins.CaSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $Pins.CaPath -cnotmatch '^[A-Za-z]:[\\/]' -or $Pins.CaPath -match '[\x00-\x1f\x7f]') {
        throw 'Owner-verified absolute CA path and digest required.'
    }
    $ca=Get-Item -LiteralPath $Pins.CaPath -ErrorAction Stop
    if ($ca.PSIsContainer -or ($ca.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        (Get-FileHash -LiteralPath $ca.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Pins.CaSha256) {
        throw 'CA file rejected.'
    }
    # Supabase supplies a PEM root certificate. Parsing is local, not proof of trust.
    $certificate=[Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem([IO.File]::ReadAllText($ca.FullName))
    try {
        $basic=@($certificate.Extensions | Where-Object { $_ -is [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension] })
        if ($basic.Count -ne 1 -or -not $basic[0].CertificateAuthority -or
            $certificate.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or
            $certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow) { throw 'Invalid CA certificate.' }
    } finally { $certificate.Dispose() }
    return $username
}

function Get-RehearsalPromptPins {
    $pins=@{}
    foreach ($key in @('HostName','Port','Database','ProjectRef','ProjectVerified','Method','TargetVerified','SecurityVerified','CaPath','CaSha256','CaVerified')) {
        $pins[$key]=Read-Host "Privately verified $key (no URI or password)"
    }
    return $pins
}
