param(
  [Parameter(Mandatory=$true)][string]$Bundle,
  [Parameter(Mandatory=$true)][string]$LifecycleEvidence,
  [Parameter(Mandatory=$true)][string]$JourneyEvidence,
  [Parameter(Mandatory=$true)][string]$IntegrityEvidence
)
$ErrorActionPreference = 'Stop'

$packageName = 'TacticusAnalytics.Desktop.Candidate'
$publisher = 'CN=Tacticus Analytics CI Ephemeral'
$firstVersion = [version]'1.0.0.0'
$secondVersion = [version]'2.0.0.0'
$scratch = Join-Path $env:RUNNER_TEMP ('tacticus-msix-' + [guid]::NewGuid().ToString('N'))
$firstPackage = Join-Path $scratch 'TacticusDesktop-1.0.0.0.msix'
$secondPackage = Join-Path $scratch 'TacticusDesktop-2.0.0.0.msix'
$publicCertificate = Join-Path $scratch 'ephemeral-test-signing.cer'
$packager = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../../apps/desktop/platform/windows/package-msix.ps1')).Path
$msixActivator = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'activate-msix.ps1')).Path
$manifestPath = Join-Path $Bundle 'bundle-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath | ConvertFrom-Json
$manifestDigest = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
$userProfile = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
if ([string]::IsNullOrWhiteSpace($userProfile)) { throw 'Current-user profile directory unavailable' }
$qualificationRoot = Join-Path $userProfile (Join-Path 'TacticusDesktopPreview' ('qualification-' + [guid]::NewGuid().ToString('N')))

$receipt = [ordered]@{
  schemaVersion = 1
  sourceSha = $manifest.sourceSha
  manifestSha256 = $manifestDigest
  platform = 'win-x64'
  artifactKind = 'ephemeral-msix-lifecycle'
  candidateOnly = $true
  ciOnly = $true
  ephemeralTestSignature = $true
  releaseSignatureQualified = $false
  standardConsumerUser = $false
  nativeInstalledArtifact = $true
  packageArtifactPublished = $false
  aumidActivationQualified = $false
  completed = $false
  installVersion = $null
  updateVersion = $null
  defaultDowngradeRefused = $false
  rollbackVersion = $null
  packageIntegrityEvidenceSha256 = $null
  packageIntegrityAssertions = @()
  updatedVersionCachedReopen = $false
  rollbackVersionCachedReopen = $false
  workspaceSentinelRetainedAcrossUpdate = $false
  workspaceSentinelRetainedAcrossRollback = $false
  workspaceRetainedAfterUninstall = $false
  workspaceTreeRetainedAfterUninstall = $false
  workspaceShapeBeforeUninstall = $null
  workspaceShapeAfterUninstall = $null
  uninstalled = $false
  packageSha256 = [ordered]@{ first = $null; second = $null }
  cleanup = [ordered]@{
    packageRegistrationRemoved = $false
    installedPackageFilesRemoved = $false
    trustedCertificateRemoved = $false
    signingCertificateAndPrivateKeyRemoved = $false
    transientFilesRemoved = $false
    qualificationRootRemoved = $false
  }
}

$thumbprint = $null
$sentinel = $null
$sentinelDigest = $null
$failure = $null
$installedLocations = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$packageMutationStarted = $false

function Get-ExactPackage {
  $packages = @(Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue)
  if ($packages.Count -ne 1) { throw 'Expected exactly one installed CI package' }
  return $packages[0]
}

function Assert-PackageVersion([version]$Expected) {
  $package = Get-ExactPackage
  if ([version]$package.Version -ne $Expected) { throw 'Installed CI package version is incorrect' }
  return $package
}

function Assert-Sentinel {
  if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) { throw 'Package workspace sentinel is missing' }
  $actual = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $sentinelDigest) { throw 'Package workspace sentinel changed' }
}

function Invoke-CachedReopen($Package, [string]$Label) {
  $workspace = Join-Path $qualificationRoot 'retained workspace ü'
  $renderer = Join-Path $env:RUNNER_TEMP "renderer-msix-$Label.json"
  $screenshot = Join-Path $env:RUNNER_TEMP "renderer-msix-$Label.png"
  $verify = Join-Path $env:RUNNER_TEMP "window-verification-msix-$Label.json"
  $measurement = Join-Path $env:RUNNER_TEMP "measurement-msix-$Label.json"
  $activationEvidence = Join-Path $env:RUNNER_TEMP "measurement-aumid-$Label.json"
  $nodeDiagnostic = Join-Path $env:RUNNER_TEMP "node-launch-diagnostic-$Label.json"
  @{ seedFormerPasswordFixture = $false; evidence = $renderer; screenshot = $screenshot } |
    ConvertTo-Json | Set-Content -Encoding utf8 $verify
  $activationExit = & $msixActivator -PackageFamilyName $Package.PackageFamilyName -Evidence $activationEvidence `
    -NodeDiagnostic $nodeDiagnostic -Arguments @('run-msix-qualified', $workspace, '--verify', $verify, `
      '--measurement', $measurement, '--launch-diagnostic', $nodeDiagnostic)
  if ($activationExit -ne 0) { throw 'Updated package cached reopen failed' }
  $result = Get-Content -LiteralPath $renderer | ConvertFrom-Json
  $nativeMeasurement = Get-Content -LiteralPath $measurement | ConvertFrom-Json
  if ($result.observed.nodeAccess -or -not $result.observed.text.Contains('+58%') -or
      $nativeMeasurement.sourceSha -ne $manifest.sourceSha -or $nativeMeasurement.exitCode -ne 0) {
    throw 'Updated package cached reopen evidence is incorrect'
  }
}

function Get-BoundedWorkspaceShape {
  $workspace = Join-Path $qualificationRoot 'retained workspace ü'
  if (-not (Test-Path -LiteralPath $workspace -PathType Container)) { throw 'Retained application workspace is missing' }
  $limit = 100000
  $entries = @(Get-ChildItem -LiteralPath $workspace -Recurse -Force | Select-Object -First ($limit + 1))
  if ($entries.Count -gt $limit) { throw 'Retained application workspace exceeds the qualification observation bound' }
  $files = @($entries | Where-Object { -not $_.PSIsContainer }).Count
  $directories = @($entries | Where-Object { $_.PSIsContainer }).Count
  if ($files -eq 0) { throw 'Retained application workspace contains no data files' }
  return [ordered]@{ files = $files; directories = $directories }
}

try {
  New-Item -ItemType Directory -Path $scratch | Out-Null
  $certificate = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature -KeyExportPolicy NonExportable `
    -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -CertStoreLocation 'Cert:\CurrentUser\My' `
    -Subject $publisher -FriendlyName 'Tacticus ephemeral CI package signing' -NotAfter (Get-Date).AddDays(1) `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
  $thumbprint = $certificate.Thumbprint
  if ($certificate.Subject -ne $publisher) { throw 'Ephemeral certificate publisher mismatch' }
  $null = Export-Certificate -Cert $certificate -FilePath $publicCertificate
  $null = Import-Certificate -FilePath $publicCertificate -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople'

  $powerShell = (Get-Command pwsh -ErrorAction Stop).Source
  $firstOutput = @(& $powerShell -NoLogo -NoProfile -NonInteractive -File $packager -Bundle $Bundle `
    -Output $firstPackage -Publisher $certificate.Subject -Version ($firstVersion.ToString()) `
    -CertificateThumbprint $thumbprint)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $firstPackage -PathType Leaf) -or $firstOutput.Count -eq 0) {
    throw 'First ephemeral package was not produced'
  }
  if (-not [System.IO.Path]::GetFullPath([string]$firstOutput[-1]).Equals(
      (Resolve-Path -LiteralPath $firstPackage).Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'First package output contract is invalid'
  }
  $secondOutput = @(& $powerShell -NoLogo -NoProfile -NonInteractive -File $packager -Bundle $Bundle `
    -Output $secondPackage -Publisher $certificate.Subject -Version ($secondVersion.ToString()) `
    -CertificateThumbprint $thumbprint)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $secondPackage -PathType Leaf) -or $secondOutput.Count -eq 0) {
    throw 'Second ephemeral package was not produced'
  }
  if (-not [System.IO.Path]::GetFullPath([string]$secondOutput[-1]).Equals(
      (Resolve-Path -LiteralPath $secondPackage).Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Second package output contract is invalid'
  }
  foreach ($packagePath in @($firstPackage, $secondPackage)) {
    $signature = Get-AuthenticodeSignature -FilePath $packagePath
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $signature.SignerCertificate.Thumbprint -ne $thumbprint) {
      throw 'Ephemeral package signature verification failed'
    }
  }
  $receipt.packageSha256.first = (Get-FileHash -LiteralPath $firstPackage -Algorithm SHA256).Hash.ToLowerInvariant()
  $receipt.packageSha256.second = (Get-FileHash -LiteralPath $secondPackage -Algorithm SHA256).Hash.ToLowerInvariant()

  if (Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue) {
    throw 'CI package identity is already registered'
  }
  $packageMutationStarted = $true
  Add-AppxPackage -Path $firstPackage
  $installed = Assert-PackageVersion $firstVersion
  $null = $installedLocations.Add($installed.InstallLocation)
  $receipt.installVersion = $installed.Version.ToString()
  $payload = Join-Path $installed.InstallLocation 'Payload'
  $installedManifest = Join-Path $payload 'bundle-manifest.json'
  if ((Get-FileHash -LiteralPath $installedManifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifestDigest) {
    throw 'Installed package payload does not match the staged bundle'
  }

  New-Item -ItemType Directory -Path $qualificationRoot -Force | Out-Null
  $sentinel = Join-Path $qualificationRoot 'ci-workspace-sentinel.txt'
  [System.IO.File]::WriteAllText($sentinel, "workspace-bound-to-$($manifest.sourceSha)", [System.Text.UTF8Encoding]::new($false))
  $sentinelDigest = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash.ToLowerInvariant()

  $integrityActivationEvidence = Join-Path $env:RUNNER_TEMP 'measurement-aumid-package-integrity.json'
  $activationExit = & $msixActivator -PackageFamilyName $installed.PackageFamilyName `
    -Evidence $integrityActivationEvidence -NoNodeLaunch -Arguments @('package-integrity-proof', $IntegrityEvidence)
  if ($activationExit -ne 0 -or -not (Test-Path -LiteralPath $IntegrityEvidence -PathType Leaf)) {
    throw 'Installed package integrity proof failed'
  }
  $integrity = Get-Content -LiteralPath $IntegrityEvidence | ConvertFrom-Json
  $requiredIntegrityAssertions = @(
    'package-child-medium-integrity',
    'package-descendant-retains-package-identity',
    'package-new-file-create-refused',
    'package-existing-write-open-refused',
    'package-existing-delete-refused',
    'package-existing-rename-refused',
    'package-rename-in-refused',
    'package-hardlink-in-refused',
    'package-symlink-reparse-create-refused',
    'package-payload-write-dac-refused',
    'package-payload-write-owner-refused'
  )
  $actualIntegrityAssertions = @($integrity.assertions)
  if ($integrity.schemaVersion -ne 1 -or $integrity.platform -ne 'win-x64' -or $integrity.packaged -ne $true -or
      $actualIntegrityAssertions.Count -ne $requiredIntegrityAssertions.Count) {
    throw 'Installed package integrity evidence is malformed'
  }
  for ($assertionIndex = 0; $assertionIndex -lt $requiredIntegrityAssertions.Count; $assertionIndex++) {
    if ($actualIntegrityAssertions[$assertionIndex] -cne $requiredIntegrityAssertions[$assertionIndex]) {
      throw 'Installed package integrity assertions are incomplete'
    }
  }
  $receipt.packageIntegrityEvidenceSha256 = (Get-FileHash -LiteralPath $IntegrityEvidence -Algorithm SHA256).Hash.ToLowerInvariant()
  $receipt.packageIntegrityAssertions = $actualIntegrityAssertions

  & (Join-Path $PSScriptRoot 'installed-journey.ps1') -Bundle $payload -Evidence $JourneyEvidence -AlreadyInstalled `
    -QualificationRoot $qualificationRoot -PackageFamilyName $installed.PackageFamilyName
  if ($LASTEXITCODE -ne 0) { throw 'Installed MSIX application journey failed' }
  $receipt.aumidActivationQualified = $true

  Add-AppxPackage -Path $secondPackage
  $installed = Assert-PackageVersion $secondVersion
  $null = $installedLocations.Add($installed.InstallLocation)
  $receipt.updateVersion = $installed.Version.ToString()
  Assert-Sentinel
  $receipt.workspaceSentinelRetainedAcrossUpdate = $true
  Invoke-CachedReopen $installed 'updated-v2'
  $receipt.updatedVersionCachedReopen = $true

  $downgradeRejected = $false
  try { Add-AppxPackage -Path $firstPackage -ErrorAction Stop }
  catch { $downgradeRejected = $true }
  if (-not $downgradeRejected) { throw 'Default package downgrade was not refused' }
  $null = Assert-PackageVersion $secondVersion
  $receipt.defaultDowngradeRefused = $true

  Add-AppxPackage -Path $firstPackage -ForceUpdateFromAnyVersion
  $installed = Assert-PackageVersion $firstVersion
  $null = $installedLocations.Add($installed.InstallLocation)
  $receipt.rollbackVersion = $installed.Version.ToString()
  Assert-Sentinel
  $receipt.workspaceSentinelRetainedAcrossRollback = $true
  Invoke-CachedReopen $installed 'rollback-v1'
  $receipt.rollbackVersionCachedReopen = $true

  $workspaceShapeBeforeUninstall = Get-BoundedWorkspaceShape
  $receipt.workspaceShapeBeforeUninstall = $workspaceShapeBeforeUninstall

  $installedLocation = $installed.InstallLocation
  Remove-AppxPackage -Package $installed.PackageFullName
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $registrationRemains = [bool](Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue)
    $packageFilesRemain = @($installedLocations | Where-Object { Test-Path -LiteralPath $_ }).Count -ne 0
    if (-not $registrationRemains -and -not $packageFilesRemain) { break }
    Start-Sleep -Seconds 1
  }
  if (Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue) { throw 'CI package registration remains after uninstall' }
  if (Test-Path -LiteralPath $installedLocation) { throw 'CI package files remain after uninstall' }
  Assert-Sentinel
  $receipt.workspaceRetainedAfterUninstall = $true
  $workspaceShapeAfterUninstall = Get-BoundedWorkspaceShape
  $receipt.workspaceShapeAfterUninstall = $workspaceShapeAfterUninstall
  if ($workspaceShapeAfterUninstall.files -ne $workspaceShapeBeforeUninstall.files -or
      $workspaceShapeAfterUninstall.directories -ne $workspaceShapeBeforeUninstall.directories) {
    throw 'Retained application workspace changed during package uninstall'
  }
  $receipt.workspaceTreeRetainedAfterUninstall = $true
  $receipt.uninstalled = $true
  $receipt.completed = $true
} catch {
  $failure = $_
} finally {
  try {
    if ($packageMutationStarted) {
      @(Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue) | ForEach-Object {
        Remove-AppxPackage -Package $_.PackageFullName -ErrorAction Stop
      }
    }
    for ($cleanupAttempt = 0; $cleanupAttempt -lt 30; $cleanupAttempt++) {
      $registrationRemains = [bool](Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue)
      $packageFilesRemain = @($installedLocations | Where-Object { Test-Path -LiteralPath $_ }).Count -ne 0
      if (-not $registrationRemains -and -not $packageFilesRemain) { break }
      Start-Sleep -Seconds 1
    }
  } catch {
    if ($null -eq $failure) { $failure = $_ }
  }
  $receipt.cleanup.packageRegistrationRemoved = -not [bool](Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue)
  try {
    $receipt.cleanup.installedPackageFilesRemoved = @($installedLocations | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0
  } catch {
    $receipt.cleanup.installedPackageFilesRemoved = $false
    if ($null -eq $failure) { $failure = $_ }
  }

  if ($thumbprint) {
    try {
      $trustedPath = "Cert:\LocalMachine\TrustedPeople\$thumbprint"
      if (Test-Path -LiteralPath $trustedPath) { Remove-Item -LiteralPath $trustedPath }
    } catch {
      if ($null -eq $failure) { $failure = $_ }
    }
    $receipt.cleanup.trustedCertificateRemoved = -not (Test-Path -LiteralPath "Cert:\LocalMachine\TrustedPeople\$thumbprint")

    try {
      $signingPath = "Cert:\CurrentUser\My\$thumbprint"
      if (Test-Path -LiteralPath $signingPath) { Remove-Item -LiteralPath $signingPath -DeleteKey }
    } catch {
      if ($null -eq $failure) { $failure = $_ }
    }
    $receipt.cleanup.signingCertificateAndPrivateKeyRemoved = -not (Test-Path -LiteralPath "Cert:\CurrentUser\My\$thumbprint")
  }

  try {
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
  } catch {
    if ($null -eq $failure) { $failure = $_ }
  }
  $receipt.cleanup.transientFilesRemoved = -not (Test-Path -LiteralPath $scratch)

  try {
    if (Test-Path -LiteralPath $qualificationRoot) { Remove-Item -LiteralPath $qualificationRoot -Recurse -Force }
  } catch {
    if ($null -eq $failure) { $failure = $_ }
  }
  $receipt.cleanup.qualificationRootRemoved = -not (Test-Path -LiteralPath $qualificationRoot)

  if (-not $receipt.cleanup.packageRegistrationRemoved -or
      -not $receipt.cleanup.installedPackageFilesRemoved -or
      -not $receipt.cleanup.trustedCertificateRemoved -or
      -not $receipt.cleanup.signingCertificateAndPrivateKeyRemoved -or
      -not $receipt.cleanup.transientFilesRemoved -or
      -not $receipt.cleanup.qualificationRootRemoved) {
    $receipt.completed = $false
    if ($null -eq $failure) { $failure = [System.InvalidOperationException]::new('Ephemeral MSIX cleanup incomplete') }
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $LifecycleEvidence
}

Get-Content -LiteralPath $LifecycleEvidence
if ($null -ne $failure) { throw $failure }
