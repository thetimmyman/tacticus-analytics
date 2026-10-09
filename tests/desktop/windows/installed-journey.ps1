param(
  [Parameter(Mandatory=$true)][string]$Bundle,
  [Parameter(Mandatory=$true)][string]$Evidence,
  [switch]$AlreadyInstalled,
  [string]$QualificationRoot,
  [string]$PackageFamilyName
)
$ErrorActionPreference = 'Stop'
# The hosted scratch volume may disable filesystem short aliases. Exercise the
# same per-user volume as ordinary installation without changing volume policy.
# Native ownership still verifies the PostgreSQL alias and protects both roots.
$qualificationProfile = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($qualificationProfile)) { throw 'Current-user application directory unavailable' }
$qualification = if ([string]::IsNullOrWhiteSpace($QualificationRoot)) {
  Join-Path $qualificationProfile ('Tacticus qualification ' + [guid]::NewGuid().ToString('N'))
} else {
  [System.IO.Path]::GetFullPath($QualificationRoot)
}
$profilePrefix = [System.IO.Path]::TrimEndingDirectorySeparator([System.IO.Path]::GetFullPath($qualificationProfile)) + [System.IO.Path]::DirectorySeparatorChar
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
$manifest = Get-Content "$installed/bundle-manifest.json" | ConvertFrom-Json
$manifestDigest = (Get-FileHash "$installed/bundle-manifest.json" -Algorithm SHA256).Hash.ToLowerInvariant()
# Keep a source/content-bound incomplete receipt if an actual runtime step fails.
@{ schemaVersion = 1; sourceSha = $manifest.sourceSha; manifestSha256 = $manifestDigest;
   platform = 'win-x64'; artifactKind = $artifactKind; distributionKind = $distributionKind; candidateOnly = $true; standardConsumerUser = $false;
   nativeInstalledArtifact = $true; qualificationLocation = 'current-user-application-directory';
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
    $activationExit = & $msixActivator -PackageFamilyName $PackageFamilyName `
      -Arguments @('run-msix-qualified', $activeWorkspace, '--verify', $verify, '--measurement', $measurementPath)
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
  $activationExit = & $msixActivator -PackageFamilyName $PackageFamilyName `
    -Arguments @('run-msix-qualified', $workspace, '--recovery', $recoveryPath)
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
    $activationExit = & $msixActivator -PackageFamilyName $PackageFamilyName `
      -Arguments @('run-msix-qualified', $proofWorkspace, '--schema-recovery', $scenario, '--schema-recovery-evidence', $proofEvidence)
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
   platform = 'win-x64'; artifactKind = $artifactKind; distributionKind = $distributionKind; candidateOnly = $true; standardConsumerUser = $false; nativeInstalledArtifact = $true;
   completed = $true; qualificationLocation = 'current-user-application-directory';
   postgresFilesystemAlias = 'verified-by-native-owner'; os = [System.Environment]::OSVersion.VersionString;
   packageFiles = $manifest.files.Count; packageBytes = ($manifest.files | Measure-Object -Property size -Sum).Sum; elapsedMs = $timer.ElapsedMilliseconds;
   journeys = $journeys; recovery = $recovery; schemaRecovery = $schemaRecovery; officialApiKeysUsed = $false; featureParityClaim = $false; syntheticDemo = $true;
   wholeProcessOfflineQualified = $false; networkBoundary = 'Electron-renderer-session-only';
   remainingGates = @('owner-approved signing and release trust', 'standard-user consumer Windows install', 'full accepted feature inventory', 'official onboarding projection integration', 'migrated real API vault bindings', 'Unicode PostgreSQL on volumes without short aliases', 'whole-process external network denial', 'rights and full notices review') } |
  ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $Evidence
Get-Content $Evidence
