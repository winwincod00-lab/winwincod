# Ephemeral synthetic CA; no certificate store changes, network or real credentials.
function New-RehearsalTestPins {
    $directory=Join-Path ([IO.Path]::GetTempPath()) ('wwc-ca-test-'+[Guid]::NewGuid())
    [void][IO.Directory]::CreateDirectory($directory)
    $path=Join-Path $directory 'synthetic-ca.pem'
    $rsa=[Security.Cryptography.RSA]::Create(2048)
    try {
        $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Offline test only', $rsa,
            [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
        $certificate=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1),[DateTimeOffset]::UtcNow.AddHours(1))
        try { [IO.File]::WriteAllText($path,$certificate.ExportCertificatePem()) } finally { $certificate.Dispose() }
    } finally { $rsa.Dispose() }
    return @{
        HostName='db.abcdefghijklmnopqrst.supabase.co'; Port='5432'; Database='synthetic'; ProjectRef='abcdefghijklmnopqrst'
        ProjectVerified='true'; Method='direct'; TargetVerified='true'; SecurityVerified='true'
        CaPath=$path; CaSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant(); CaVerified='true'
        DeployApproval='D2-B-EXPLICITLY-APPROVED'; FirstApproval='FIRST-REHEARSAL-EXPLICITLY-APPROVED'
    }
}
function Remove-RehearsalTestPins {
    param([hashtable]$Pins)
    # Only the exact generated file and its now-empty directory; no recursive removal.
    [IO.File]::Delete($Pins.CaPath)
    [IO.Directory]::Delete([IO.Path]::GetDirectoryName($Pins.CaPath))
}
