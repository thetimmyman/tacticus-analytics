param(
  [Parameter(Mandatory=$true)][string]$Bundle,
  [Parameter(Mandatory=$true)][string]$Evidence,
  [switch]$AlreadyInstalled,
  [string]$QualificationRoot,
  [string]$PackageFamilyName,
  [switch]$StandardUser,
  [string]$ExpectedManifestSha256,
  [string]$ExpectedSourceSha
)
$ErrorActionPreference = 'Stop'
# The proof driver verifies candidate data before invoking candidate code. This
# is a trusted, non-concurrent qualification snapshot, not same-user immutability.
function Assert-ManifestFields($Value, [string[]]$Names) {
  if ($null -eq $Value -or $Value -isnot [pscustomobject]) { throw 'Invalid bundle manifest object' }
  $actual = @($Value.PSObject.Properties.Name)
  if ($actual.Count -ne $Names.Count) { throw 'Unexpected bundle manifest fields' }
  foreach ($name in $Names) {
    if ($actual -cnotcontains $name) { throw 'Missing bundle manifest field' }
  }
}
function Read-VerifiedBundleManifest([string]$Root, [string]$ExpectedDigest = '', [string]$ExpectedSource = '', $ExpectedManifest = $null) {
  $rootPath = [System.IO.Path]::GetFullPath($Root)
  for ($parent = $rootPath; $null -ne $parent; $parent = [System.IO.Path]::GetDirectoryName($parent)) {
    if ((Get-Item -LiteralPath $parent -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      throw 'Package reparse paths are unsupported'
    }
  }
  if (-not (Get-Item -LiteralPath $rootPath -Force).PSIsContainer) { throw 'Bundle directory required' }
  $manifestPath = Join-Path $rootPath 'bundle-manifest.json'
  $manifestItem = Get-Item -LiteralPath $manifestPath -Force
  if ($manifestItem.PSIsContainer -or ($manifestItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or
      $manifestItem.Length -gt 4 * 1024 * 1024) { throw 'Invalid bundle manifest file' }
  $bytes = [System.IO.File]::ReadAllBytes($manifestPath)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $manifestDigest = ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
  if ($ExpectedDigest -and $manifestDigest -cne $ExpectedDigest) { throw 'Candidate does not match the reviewed manifest' }
  $text = [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes).TrimStart([char]0xfeff)
  $manifest = $text | ConvertFrom-Json
  Assert-ManifestFields $manifest @('schemaVersion', 'platform', 'sourceSha', 'files')
  if (($manifest.schemaVersion -isnot [int] -and $manifest.schemaVersion -isnot [long]) -or $manifest.schemaVersion -ne 1 -or
      $manifest.platform -isnot [string] -or $manifest.platform -cne 'win-x64' -or $manifest.sourceSha -isnot [string] -or
      $manifest.sourceSha -cnotmatch '^[a-f0-9]{40}$' -or $manifest.files -isnot [array] -or
      $manifest.files.Count -eq 0 -or $manifest.files.Count -gt 20000) { throw 'Unsupported bundle manifest' }
  if ($ExpectedSource -and $manifest.sourceSha -cne $ExpectedSource) { throw 'Candidate does not match the reviewed source' }
  $expected = [System.Collections.Generic.Dictionary[string,object]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $manifest.files) {
    Assert-ManifestFields $entry @('path', 'size', 'sha256')
    if ($entry.path -isnot [string] -or $entry.path.Length -eq 0 -or $entry.path.Length -gt 240 -or
        $entry.path.StartsWith('/') -or $entry.path -cmatch '[\\:\x00]' -or
        $entry.path -ieq 'bundle-manifest.json' -or $entry.sha256 -isnot [string] -or
        $entry.sha256 -cnotmatch '^[a-f0-9]{64}$' -or
        ($entry.size -isnot [int] -and $entry.size -isnot [long]) -or
        $entry.size -lt 0 -or $entry.size -gt 2GB -or $expected.ContainsKey($entry.path)) {
      throw 'Invalid bundle inventory entry'
    }
    foreach ($part in $entry.path.Split('/')) {
      if ($part -in @('', '.', '..') -or $part.EndsWith('.') -or $part.EndsWith(' ') -or
          $part -cmatch '[\x00-\x1f<>"|?*]' -or
          $part.Split('.')[0] -imatch '^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$') { throw 'Unsafe bundle inventory path' }
    }
    $expected.Add($entry.path, $entry)
  }
  if (-not $expected.ContainsKey('TacticusDesktop.exe')) { throw 'Declared launcher required' }
  if ($null -ne $ExpectedManifest) { Assert-SameBundleManifest $ExpectedManifest $manifest }
  $prefix = $rootPath.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
  $pending = [System.Collections.Generic.Stack[string]]::new()
  $pending.Push($rootPath)
  while ($pending.Count -ne 0) {
    $directory = $pending.Pop()
    foreach ($item in (Get-ChildItem -LiteralPath $directory -Force)) {
      if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Package reparse paths are unsupported' }
      if ($item.PSIsContainer) { $pending.Push($item.FullName); continue }
      $relative = $item.FullName.Substring($prefix.Length).Replace('\', '/')
      if ($relative -ieq 'bundle-manifest.json') { continue }
      if (-not $expected.ContainsKey($relative)) { throw 'Unexpected package file' }
      $entry = $expected[$relative]
      if ($item.Length -ne $entry.size -or
          (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) {
        throw 'Package inventory content mismatch'
      }
      [void]$expected.Remove($relative)
    }
  }
  if ($expected.Count -ne 0) { throw 'Missing package file' }
  return [pscustomobject]@{ Manifest = $manifest; Sha256 = $manifestDigest }
}
function Assert-SameBundleManifest($Expected, $Actual) {
  if ($Actual.schemaVersion -ne $Expected.schemaVersion -or $Actual.platform -cne $Expected.platform -or
      $Actual.sourceSha -cne $Expected.sourceSha -or $Actual.files.Count -ne $Expected.files.Count) {
    throw 'Installed candidate does not match the reviewed source and inventory'
  }
  $entries = [System.Collections.Generic.Dictionary[string,object]]::new([System.StringComparer]::Ordinal)
  foreach ($entry in $Expected.files) { $entries.Add($entry.path, $entry) }
  foreach ($entry in $Actual.files) {
    if (-not $entries.ContainsKey($entry.path) -or $entry.size -ne $entries[$entry.path].size -or
        $entry.sha256 -cne $entries[$entry.path].sha256) {
      throw 'Installed candidate does not match the reviewed source and inventory'
    }
  }
}
if ($StandardUser) {
  if (-not [System.Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -eq 0) {
    throw 'Standard-user qualification requires an interactive Windows desktop session'
  }
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  try {
    # Raw group membership also catches filtered or deny-only privileged SIDs.
    if (@($identity.Groups | Where-Object { $_.Value -in @('S-1-5-32-544', 'S-1-5-32-547') }).Count -ne 0) {
      throw 'Sign in with a standard user account for this qualification'
    }
  } finally { $identity.Dispose() }
  if ($ExpectedManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedSourceSha -cnotmatch '^[a-f0-9]{40}$') {
    throw 'Reviewed manifest digest and source commit are required'
  }
  $reviewedBundle = Read-VerifiedBundleManifest -Root $Bundle -ExpectedDigest $ExpectedManifestSha256 -ExpectedSource $ExpectedSourceSha
}
# The hosted scratch volume may disable filesystem short aliases. Exercise a
# durable per-user volume without changing volume policy. Packaged state stays
# outside virtualized AppData; the unpackaged regression fixture retains its
# original application-data contract.
$qualificationFolder = if ($AlreadyInstalled) {
  [System.Environment+SpecialFolder]::UserProfile
} else {
  [System.Environment+SpecialFolder]::LocalApplicationData
}
$qualificationProfile = [System.Environment]::GetFolderPath($qualificationFolder)
if ([string]::IsNullOrWhiteSpace($qualificationProfile)) { throw 'Current-user qualification directory unavailable' }
$qualification = if ([string]::IsNullOrWhiteSpace($QualificationRoot)) {
  Join-Path $qualificationProfile ('Tacticus qualification ' + [guid]::NewGuid().ToString('N'))
} else {
  [System.IO.Path]::GetFullPath($QualificationRoot)
}
$profilePrefix = [System.IO.Path]::GetFullPath($qualificationProfile).TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
if (-not ($qualification + [System.IO.Path]::DirectorySeparatorChar).StartsWith($profilePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Qualification root must be inside the current-user application directory'
}
$install = Join-Path $qualification 'installed Tacticus ü'
$workspace = Join-Path $qualification 'retained workspace ü'
$verify = Join-Path $env:RUNNER_TEMP 'window-verification.json'
$timer = [System.Diagnostics.Stopwatch]::StartNew()
$artifactKind = if ($AlreadyInstalled) { 'installed-msix-candidate' } else { 'installed-candidate' }
$distributionKind = if ($AlreadyInstalled) { 'ephemeral-msix' } else { 'staged-directory' }
if ($AlreadyInstalled) {
  if ([string]::IsNullOrWhiteSpace($PackageFamilyName)) { throw 'Installed package family name is required' }
  $msixActivator = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'activate-msix.ps1')).Path
  $installed = (Resolve-Path -LiteralPath $Bundle).Path
  if (-not (Test-Path -LiteralPath (Join-Path $installed 'TacticusDesktop.exe') -PathType Leaf)) {
    throw 'Installed package payload is incomplete'
  }
} else {
  & "$Bundle/TacticusDesktop.exe" install-candidate $Bundle $install
  if ($LASTEXITCODE -ne 0) { throw 'Candidate installation failed' }
  $active = (Get-Content "$install/current.json" | ConvertFrom-Json).version
  $installed = Join-Path $install "versions/$active"
}
if ($StandardUser) {
  $installedBundle = Read-VerifiedBundleManifest -Root $installed -ExpectedManifest $reviewedBundle.Manifest
  $manifest = $installedBundle.Manifest
  $manifestDigest = $installedBundle.Sha256
} else {
  $manifest = Get-Content "$installed/bundle-manifest.json" | ConvertFrom-Json
  $manifestDigest = (Get-FileHash "$installed/bundle-manifest.json" -Algorithm SHA256).Hash.ToLowerInvariant()
}
# Keep a source/content-bound incomplete receipt if an actual runtime step fails.
@{ schemaVersion = 1; sourceSha = $manifest.sourceSha; manifestSha256 = $manifestDigest;
   platform = 'win-x64'; artifactKind = $artifactKind; distributionKind = $distributionKind; candidateOnly = $true; standardConsumerUser = [bool]$StandardUser;
   nativeInstalledArtifact = $true; qualificationLocation = $(if ($AlreadyInstalled) { 'current-user-profile' } else { 'current-user-application-directory' });
   postgresFilesystemAlias = 'not-yet-verified'; completed = $false; os = [System.Environment]::OSVersion.VersionString;
   packageFiles = $manifest.files.Count; packageBytes = ($manifest.files | Measure-Object -Property size -Sum).Sum;
   officialApiKeysUsed = $false; featureParityClaim = $false; wholeProcessOfflineQualified = $false;
   networkBoundary = 'Electron-renderer-session-only'; actualJourney = 'not completed' } |
  ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $Evidence
Get-Content $Evidence
$journeys = @()
$migrationWorkspace = Join-Path $qualification 'former password workspace ü'
for ($iteration = 0; $iteration -lt 4; $iteration++) {
  $activeWorkspace = if ($iteration -lt 2) { $workspace } else { $migrationWorkspace }
  $scenario = @('fresh automatic setup','local cached reopen','former password owner migration','migrated local cached reopen')[$iteration]
  $renderer = Join-Path $env:RUNNER_TEMP "renderer-$iteration.json"
  @{ seedFormerPasswordFixture = ($iteration -eq 2); evidence = $renderer; screenshot = (Join-Path $env:RUNNER_TEMP "renderer-$iteration.png") } |
    ConvertTo-Json | Set-Content -Encoding utf8 $verify
  $runTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $measurementPath = Join-Path $env:RUNNER_TEMP "measurement-$iteration.json"
  if ($AlreadyInstalled) {
    $activationEvidence = Join-Path $env:RUNNER_TEMP "measurement-aumid-journey-$iteration.json"
    $nodeDiagnostic = Join-Path $env:RUNNER_TEMP "node-launch-diagnostic-journey-$iteration.json"
    $activationExit = & $msixActivator -PackageFamilyName $PackageFamilyName -Evidence $activationEvidence `
      -NodeDiagnostic $nodeDiagnostic -Arguments @('run-msix-qualified', $activeWorkspace, '--verify', $verify, `
        '--measurement', $measurementPath, '--launch-diagnostic', $nodeDiagnostic)
    if ($activationExit -ne 0) { throw 'Installed complete application journey failed' }
  } else {
    & "$installed/TacticusDesktop.exe" run-candidate $installed $activeWorkspace --verify $verify --measurement $measurementPath
    if ($LASTEXITCODE -ne 0) { throw 'Installed complete application journey failed' }
  }
  $result = Get-Content $renderer | ConvertFrom-Json
  if ($result.observed.nodeAccess -or -not $result.observed.text.Contains('+58%')) { throw 'Renderer result incorrect' }
  $journeys += @{ iteration = $iteration; scenario = $scenario; elapsedMs = $runTimer.ElapsedMilliseconds; nativeMeasurement = (Get-Content $measurementPath | ConvertFrom-Json); screenshotSha256 = (Get-FileHash (Join-Path $env:RUNNER_TEMP "renderer-$iteration.png") -Algorithm SHA256).Hash.ToLowerInvariant(); automaticDeviceSession = $result.automaticDeviceSession; signedOutNativeRecovery = $result.signedOutNativeRecovery; rendererBootstrapStatus = $result.rendererBootstrapStatus; workspaceSessionReuse = $result.workspaceSessionReuse; sandbox = $result.sandbox; nodeAccess = $result.observed.nodeAccess }
}
$recoveryPath = Join-Path $env:RUNNER_TEMP 'recovery-evidence.json'
if ($AlreadyInstalled) {
  $recoveryMeasurement = Join-Path $env:RUNNER_TEMP 'measurement-recovery.json'
  $activationEvidence = Join-Path $env:RUNNER_TEMP 'measurement-aumid-recovery.json'
  $nodeDiagnostic = Join-Path $env:RUNNER_TEMP 'node-launch-diagnostic-recovery.json'
  $activationExit = & $msixActivator -PackageFamilyName $PackageFamilyName -Evidence $activationEvidence `
    -NodeDiagnostic $nodeDiagnostic -Arguments @('run-msix-qualified', $workspace, '--recovery', $recoveryPath, `
      '--measurement', $recoveryMeasurement, '--launch-diagnostic', $nodeDiagnostic)
  if ($activationExit -ne 0) { throw 'Installed database recovery qualification failed' }
} else {
  & "$installed/TacticusDesktop.exe" run-candidate $installed $workspace --recovery $recoveryPath
  if ($LASTEXITCODE -ne 0) { throw 'Installed database recovery qualification failed' }
}
$recovery = Get-Content $recoveryPath | ConvertFrom-Json
$schemaRecovery = @()
# Separate fresh workspaces retain the existing native owner/ACL/restricted
# token/Job Object boundary. These follow, and cannot replace, the primary
# graphical journeys or the original five-control recovery verdict above.
foreach ($scenario in @('interrupted-bootstrap', 'committed-marker-refusal')) {
  $proofWorkspace = Join-Path $qualification ("schema $scenario workspace ü")
  $proofEvidence = Join-Path $env:RUNNER_TEMP ("renderer-schema-recovery-$scenario.json")
  if ($AlreadyInstalled) {
    $schemaMeasurement = Join-Path $env:RUNNER_TEMP ("measurement-schema-recovery-$scenario.json")
    $activationEvidence = Join-Path $env:RUNNER_TEMP ("measurement-aumid-schema-recovery-$scenario.json")
    $nodeDiagnostic = Join-Path $env:RUNNER_TEMP ("node-launch-diagnostic-schema-recovery-$scenario.json")
    $activationExit = & $msixActivator -PackageFamilyName $PackageFamilyName -Evidence $activationEvidence `
      -NodeDiagnostic $nodeDiagnostic -Arguments @('run-msix-qualified', $proofWorkspace, '--schema-recovery', $scenario, `
        '--schema-recovery-evidence', $proofEvidence, '--measurement', $schemaMeasurement, '--launch-diagnostic', $nodeDiagnostic)
    if ($activationExit -ne 0) { throw 'Installed schema recovery proof failed' }
  } else {
    & "$installed/TacticusDesktop.exe" run-candidate $installed $proofWorkspace --schema-recovery $scenario --schema-recovery-evidence $proofEvidence
    if ($LASTEXITCODE -ne 0) { throw 'Installed schema recovery proof failed' }
  }
  $proof = Get-Content $proofEvidence | ConvertFrom-Json
  if (-not $proof.completed -or $proof.scenario -ne $scenario -or $proof.sourceSha -ne $manifest.sourceSha -or $proof.manifestSha256 -ne $manifestDigest) {
    throw 'Installed schema recovery evidence binding failed'
  }
  $schemaRecovery += $proof
}
@{ schemaVersion = 1; sourceSha = $manifest.sourceSha; manifestSha256 = $manifestDigest;
   platform = 'win-x64'; artifactKind = $artifactKind; distributionKind = $distributionKind; candidateOnly = $true; standardConsumerUser = [bool]$StandardUser; nativeInstalledArtifact = $true;
   completed = $true; qualificationLocation = $(if ($AlreadyInstalled) { 'current-user-profile' } else { 'current-user-application-directory' });
   postgresFilesystemAlias = 'verified-by-native-owner'; os = [System.Environment]::OSVersion.VersionString;
   packageFiles = $manifest.files.Count; packageBytes = ($manifest.files | Measure-Object -Property size -Sum).Sum; elapsedMs = $timer.ElapsedMilliseconds;
   journeys = $journeys; recovery = $recovery; schemaRecovery = $schemaRecovery; officialApiKeysUsed = $false; featureParityClaim = $false; syntheticDemo = $true;
   wholeProcessOfflineQualified = $false; networkBoundary = 'Electron-renderer-session-only';
   remainingGates = @('owner-approved signing and release trust', 'standard-user consumer Windows install', 'full accepted feature inventory', 'official onboarding projection integration', 'migrated real API vault bindings', 'Unicode PostgreSQL on volumes without short aliases', 'whole-process external network denial', 'rights and full notices review') } |
  ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $Evidence
Get-Content $Evidence
