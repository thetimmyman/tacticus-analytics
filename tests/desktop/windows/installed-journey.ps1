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
$journeys = @()
for ($iteration = 0; $iteration -lt 2; $iteration++) {
  $renderer = Join-Path $env:RUNNER_TEMP "renderer-$iteration.json"
  @{ password = 'synthetic-local-password'; evidence = $renderer; screenshot = (Join-Path $env:RUNNER_TEMP "renderer-$iteration.png") } |
    ConvertTo-Json | Set-Content -Encoding utf8 $verify
  $runTimer = [System.Diagnostics.Stopwatch]::StartNew()
  & "$installed/TacticusDesktop.exe" run-candidate $installed $workspace --verify $verify
  if ($LASTEXITCODE -ne 0) { throw 'Installed complete application journey failed' }
  $result = Get-Content $renderer | ConvertFrom-Json
  if ($result.observed.nodeAccess -or -not $result.observed.text.Contains('+58%')) { throw 'Renderer result incorrect' }
  $journeys += @{ iteration = $iteration; elapsedMs = $runTimer.ElapsedMilliseconds; sandbox = $result.sandbox; nodeAccess = $result.observed.nodeAccess }
}
$manifest = Get-Content "$installed/bundle-manifest.json" | ConvertFrom-Json
@{ schemaVersion = 1; sourceSha = $manifest.sourceSha; manifestSha256 = (Get-FileHash "$installed/bundle-manifest.json" -Algorithm SHA256).Hash.ToLowerInvariant();
   platform = 'win-x64'; artifactKind = 'installed-candidate'; candidateOnly = $true; standardConsumerUser = $false; nativeInstalledArtifact = $true;
   packageFiles = $manifest.files.Count; packageBytes = ($manifest.files | Measure-Object -Property size -Sum).Sum; elapsedMs = $timer.ElapsedMilliseconds;
   journeys = $journeys; officialApiKeysUsed = $false; featureParityClaim = $false; syntheticDemo = $true;
   remainingGates = @('owner-approved signing and release trust', 'standard-user consumer Windows install', 'full accepted feature inventory', 'official onboarding projection integration', 'rights and full notices review') } |
  ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $Evidence
Get-Content $Evidence
