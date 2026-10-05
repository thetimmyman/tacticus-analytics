param([Parameter(Mandatory=$true)][string]$Bundle, [Parameter(Mandatory=$true)][string]$Evidence)
$ErrorActionPreference = 'Stop'
$install = Join-Path $env:RUNNER_TEMP 'installed Tacticus ü'
$workspace = Join-Path $env:RUNNER_TEMP 'retained workspace ü'
$verify = Join-Path $env:RUNNER_TEMP 'window-verification.json'
$timer = [System.Diagnostics.Stopwatch]::StartNew()
& "$Bundle/TacticusDesktop.exe" install-candidate $Bundle $install
if ($LASTEXITCODE -ne 0) { throw 'Candidate installation failed' }
$active = (Get-Content "$install/current.json" | ConvertFrom-Json).version
$installed = Join-Path $install "versions/$active"
$manifest = Get-Content "$installed/bundle-manifest.json" | ConvertFrom-Json
$manifestDigest = (Get-FileHash "$installed/bundle-manifest.json" -Algorithm SHA256).Hash.ToLowerInvariant()
# Keep a source/content-bound incomplete receipt if an actual runtime step fails.
@{ schemaVersion = 1; sourceSha = $manifest.sourceSha; manifestSha256 = $manifestDigest;
   platform = 'win-x64'; artifactKind = 'installed-candidate'; candidateOnly = $true; standardConsumerUser = $false;
   nativeInstalledArtifact = $true; completed = $false; os = [System.Environment]::OSVersion.VersionString;
   packageFiles = $manifest.files.Count; packageBytes = ($manifest.files | Measure-Object -Property size -Sum).Sum;
   officialApiKeysUsed = $false; featureParityClaim = $false; actualJourney = 'not completed' } |
  ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $Evidence
Get-Content $Evidence
$journeys = @()
$migrationWorkspace = Join-Path $env:RUNNER_TEMP 'former password workspace ü'
for ($iteration = 0; $iteration -lt 4; $iteration++) {
  $activeWorkspace = if ($iteration -lt 2) { $workspace } else { $migrationWorkspace }
  $scenario = @('fresh automatic setup','offline reopen','former password owner migration','migrated offline reopen')[$iteration]
  $renderer = Join-Path $env:RUNNER_TEMP "renderer-$iteration.json"
  @{ seedFormerPasswordFixture = ($iteration -eq 2); evidence = $renderer; screenshot = (Join-Path $env:RUNNER_TEMP "renderer-$iteration.png") } |
    ConvertTo-Json | Set-Content -Encoding utf8 $verify
  $runTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $measurementPath = Join-Path $env:RUNNER_TEMP "measurement-$iteration.json"
  & "$installed/TacticusDesktop.exe" run-candidate $installed $activeWorkspace --verify $verify --measurement $measurementPath
  if ($LASTEXITCODE -ne 0) { throw 'Installed complete application journey failed' }
  $result = Get-Content $renderer | ConvertFrom-Json
  if ($result.observed.nodeAccess -or -not $result.observed.text.Contains('+58%')) { throw 'Renderer result incorrect' }
  $journeys += @{ iteration = $iteration; scenario = $scenario; elapsedMs = $runTimer.ElapsedMilliseconds; nativeMeasurement = (Get-Content $measurementPath | ConvertFrom-Json); screenshotSha256 = (Get-FileHash (Join-Path $env:RUNNER_TEMP "renderer-$iteration.png") -Algorithm SHA256).Hash.ToLowerInvariant(); automaticDeviceSession = $result.automaticDeviceSession; signedOutNativeRecovery = $result.signedOutNativeRecovery; rendererBootstrapStatus = $result.rendererBootstrapStatus; workspaceSessionReuse = $result.workspaceSessionReuse; sandbox = $result.sandbox; nodeAccess = $result.observed.nodeAccess }
}
$recoveryPath = Join-Path $env:RUNNER_TEMP 'recovery-evidence.json'
& "$installed/TacticusDesktop.exe" run-candidate $installed $workspace --recovery $recoveryPath
if ($LASTEXITCODE -ne 0) { throw 'Installed database recovery qualification failed' }
$recovery = Get-Content $recoveryPath | ConvertFrom-Json
@{ schemaVersion = 1; sourceSha = $manifest.sourceSha; manifestSha256 = $manifestDigest;
   platform = 'win-x64'; artifactKind = 'installed-candidate'; candidateOnly = $true; standardConsumerUser = $false; nativeInstalledArtifact = $true;
   completed = $true; os = [System.Environment]::OSVersion.VersionString;
   packageFiles = $manifest.files.Count; packageBytes = ($manifest.files | Measure-Object -Property size -Sum).Sum; elapsedMs = $timer.ElapsedMilliseconds;
   journeys = $journeys; recovery = $recovery; officialApiKeysUsed = $false; featureParityClaim = $false; syntheticDemo = $true;
   remainingGates = @('owner-approved signing and release trust', 'standard-user consumer Windows install', 'full accepted feature inventory', 'official onboarding projection integration', 'migrated real API vault bindings', 'Unicode PostgreSQL on volumes without short aliases', 'rights and full notices review') } |
  ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $Evidence
Get-Content $Evidence
