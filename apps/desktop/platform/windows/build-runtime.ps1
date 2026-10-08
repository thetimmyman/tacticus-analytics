param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path "$PSScriptRoot/../../../..").Path
$work = Join-Path $env:RUNNER_TEMP 'windows-runtime-inputs'
New-Item -ItemType Directory -Path $work -ErrorAction Stop | Out-Null
function Get-VerifiedArchive([string]$Name, [string]$Url, [string]$Digest) {
  $archive = Join-Path $work "$Name.zip"
  Invoke-WebRequest -Uri $Url -OutFile $archive
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Digest) { throw 'Runtime input digest mismatch' }
  $directory = Join-Path $work $Name
  Expand-Archive -LiteralPath $archive -DestinationPath $directory
  return $directory
}
$pg = Get-VerifiedArchive 'postgres' 'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260609' 'e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2'
$node = Get-VerifiedArchive 'node' 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-win-x64.zip' '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'
$electron = Get-VerifiedArchive 'electron' 'https://github.com/electron/electron/releases/download/v44.5.1/electron-v44.5.1-win32-x64.zip' '9b382492dcfee91f8f9e92c91f7972550a1b95d2299cac72279dab33a600d7db'
$rest = Get-VerifiedArchive 'rest' 'https://github.com/PostgREST/postgrest/releases/download/v16.4/postgrest-v16.4-windows-x86-64.zip' '29a5b56e5a09b7168bb552ef14aa7ade40bf0a81dd0687cffa86610187b89d78'
# Auth does not publish a Windows binary. Build the exact public release source, with module verification.
$authArchive = Join-Path $work 'auth-source.zip'
Invoke-WebRequest -Uri 'https://github.com/supabase/auth/archive/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3.zip' -OutFile $authArchive
if ((Get-FileHash $authArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'b35bab74f6a45e0593e7a113e30f85c12c83bbb540940c3e82eeb0a9af76a297') { throw 'Auth source archive digest mismatch' }
Expand-Archive -LiteralPath $authArchive -DestinationPath (Join-Path $work 'auth-source')
$authSource = Join-Path $work 'auth-source/auth-4eee58f296d9698a1c2c0ae14d7a0b379c7622d3'
$auth = Join-Path $work 'auth'
New-Item -ItemType Directory -Path $auth | Out-Null
Push-Location $authSource
try {
  # The reviewed Windows-only source adaptation requests exclusive binding, never Windows SO_REUSEADDR.
  # Checkout may use CRLF while the verified upstream archive uses LF.
  $patch = Join-Path $work 'auth-windows.patch'
  [System.IO.File]::WriteAllText($patch, [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'auth-windows.patch')).Replace("`r`n", "`n"), [System.Text.UTF8Encoding]::new($false))
  git apply --check $patch
  if ($LASTEXITCODE -ne 0) { throw 'Pinned Auth socket adaptation no longer applies' }
  git apply $patch
  if ($LASTEXITCODE -ne 0) { throw 'Auth socket adaptation failed' }
  $env:CGO_ENABLED = '0'; $env:GOOS = 'windows'; $env:GOARCH = 'amd64'
  go mod download
  if ($LASTEXITCODE -ne 0) { throw 'Auth dependency download failed' }
  go mod verify
  if ($LASTEXITCODE -ne 0) { throw 'Auth dependency verification failed' }
  go build -trimpath -buildvcs=false -ldflags '-X github.com/supabase/auth/internal/utilities.Version=v2.197.0+windows.1' -o (Join-Path $auth 'auth.exe') .
  if ($LASTEXITCODE -ne 0) { throw 'Pinned Auth source does not build natively for Windows' }
  Copy-Item -Recurse 'migrations' $auth
  Copy-Item 'LICENSE' $auth
} finally { Pop-Location }
$application = Join-Path $work 'application'
node apps/desktop/proof/stage-standalone.mjs $application
if ($LASTEXITCODE -ne 0) { throw 'Standalone application staging failed' }
# Next's file tracing includes the Sharp .node module but omits its adjacent DLLs.
# Preserve the full exact npm-ci package, including both libvips DLLs and licenses.
$sharpSource = Join-Path $sourceRoot 'node_modules/@img/sharp-win32-x64'
$sharpDestination = Join-Path $application 'node_modules/@img/sharp-win32-x64'
if (-not (Test-Path -LiteralPath (Join-Path $sharpSource 'lib/libvips-42.dll')) -or
    -not (Test-Path -LiteralPath (Join-Path $sharpSource 'lib/libvips-cpp-8.18.6.dll'))) { throw 'Locked Windows Sharp dependency payload unavailable' }
New-Item -ItemType Directory -Path $sharpDestination -Force | Out-Null
Copy-Item -Path (Join-Path $sharpSource '*') -Destination $sharpDestination -Recurse -Force
$native = Join-Path $work 'native'
dotnet publish apps/desktop/platform/windows/native/WindowsHost.csproj -c Release -r win-x64 --self-contained true -p:DebugType=None -p:DebugSymbols=false -p:ContinuousIntegrationBuild=true -o $native
if ($LASTEXITCODE -ne 0) { throw 'Native host publish failed' }
$crtPath = & (Join-Path $PSScriptRoot 'crt-runtime.ps1')
$config = @{
  output = $Output; application = $application; postgres = (Join-Path $pg 'pgsql'); node = (Join-Path $node 'node-v22.23.2-win-x64/node.exe')
  electron = $electron; auth = $auth; postgrest = (Join-Path $rest 'postgrest.exe'); native = $native; vcRuntime = $crtPath; sourceSha = (git rev-parse HEAD)
}
$configPath = Join-Path $work 'stage-config.json'
$config | ConvertTo-Json | Set-Content -Encoding utf8 $configPath
node apps/desktop/platform/windows/stage.mjs $configPath
if ($LASTEXITCODE -ne 0) { throw 'Windows package staging failed' }
