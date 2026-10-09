[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Bundle,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Output,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Publisher,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Version,

  [string]$CertificateThumbprint
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Resolve-FileSystemDirectory([string]$Path, [string]$Name) {
  try {
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
  } catch {
    throw "$Name does not exist: $Path"
  }
  if ($resolved.Provider.Name -ne 'FileSystem' -or -not (Test-Path -LiteralPath $resolved.Path -PathType Container)) {
    throw "$Name must be a file-system directory: $Path"
  }
  return $resolved.Path
}

function Assert-PackageVersion([string]$Value) {
  $parts = $Value.Split('.')
  if ($parts.Count -ne 4) {
    throw 'Version must contain four dot-separated numeric parts.'
  }
  foreach ($part in $parts) {
    if ($part -notmatch '^\d{1,5}$' -or [uint32]$part -gt 65535) {
      throw 'Each Version part must be an integer from 0 through 65535.'
    }
  }
}

function Assert-Publisher([string]$Value) {
  if ($Value -match '[\x00-\x1f]' -or $Value -notmatch '^\s*CN\s*=') {
    throw 'Publisher must be an X.500 distinguished name beginning with CN=.'
  }
  try {
    $null = [System.Security.Cryptography.X509Certificates.X500DistinguishedName]::new($Value)
  } catch {
    throw 'Publisher must be a valid X.500 distinguished name.'
  }
}

function Find-WindowsSdkTools {
  $roots = [System.Collections.Generic.List[string]]::new()
  try {
    $installedRoot = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -ErrorAction Stop).KitsRoot10
    if ($installedRoot) { $roots.Add((Join-Path $installedRoot 'bin')) }
  } catch {
    # Fall back to the standard SDK locations below.
  }
  if (${env:ProgramFiles(x86)}) { $roots.Add((Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin')) }
  if ($env:ProgramFiles) { $roots.Add((Join-Path $env:ProgramFiles 'Windows Kits\10\bin')) }

  $candidates = foreach ($root in ($roots | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    foreach ($directory in (Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
      $sdkVersion = $null
      if (-not [System.Version]::TryParse($directory.Name, [ref]$sdkVersion)) { continue }
      $makeAppx = Join-Path $directory.FullName 'x64\makeappx.exe'
      $signTool = Join-Path $directory.FullName 'x64\signtool.exe'
      if ((Test-Path -LiteralPath $makeAppx -PathType Leaf) -and (Test-Path -LiteralPath $signTool -PathType Leaf)) {
        [pscustomobject]@{ Version = $sdkVersion; MakeAppx = $makeAppx; SignTool = $signTool }
      }
    }
  }
  $selected = $candidates | Sort-Object -Property Version -Descending | Select-Object -First 1
  if (-not $selected) {
    throw 'A Windows 10 or Windows 11 SDK with x64 MakeAppx.exe and SignTool.exe is required.'
  }
  return $selected
}

function Write-SquarePng([System.Drawing.Image]$Source, [int]$Size, [string]$Destination) {
  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.DrawImage($Source, 0, 0, $Size, $Size)
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
}

function Get-SigningCertificate([string]$Thumbprint, [string]$ExpectedPublisher) {
  $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$Thumbprint" -ErrorAction SilentlyContinue
  $machineStore = $false
  if (-not $certificate) {
    $certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$Thumbprint" -ErrorAction SilentlyContinue
    $machineStore = $true
  }
  if (-not $certificate) { throw 'CertificateThumbprint was not found in the CurrentUser or LocalMachine personal certificate store.' }
  if (-not $certificate.HasPrivateKey) { throw 'The signing certificate does not have an accessible private key.' }
  if ($certificate.NotBefore -gt [DateTime]::Now -or $certificate.NotAfter -le [DateTime]::Now) {
    throw 'The signing certificate is not currently valid.'
  }
  $expectedName = [System.Security.Cryptography.X509Certificates.X500DistinguishedName]::new($ExpectedPublisher)
  # Compare decoded canonical names rather than DER bytes. Equivalent X.500
  # names can encode the same value with different ASN.1 string types.
  $actualSubject = $certificate.SubjectName.Name.Trim()
  $expectedSubject = $expectedName.Name.Trim()
  if (-not [string]::Equals($actualSubject, $expectedSubject, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Publisher does not match the signing certificate subject.'
  }
  return [pscustomobject]@{ Certificate = $certificate; MachineStore = $machineStore }
}

Assert-PackageVersion $Version
Assert-Publisher $Publisher
$bundlePath = Resolve-FileSystemDirectory $Bundle 'Bundle'
if ((Get-Item -LiteralPath $bundlePath -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
  throw 'Bundle must not be a reparse point.'
}
if (-not (Test-Path -LiteralPath (Join-Path $bundlePath 'TacticusDesktop.exe') -PathType Leaf)) {
  throw 'Bundle must contain TacticusDesktop.exe at its root.'
}
$reparseEntry = Get-ChildItem -LiteralPath $bundlePath -Recurse -Force |
  Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint } |
  Select-Object -First 1
if ($reparseEntry) { throw "Bundle contains a reparse point: $($reparseEntry.FullName)" }

$outputPath = [System.IO.Path]::GetFullPath($Output)
if ([System.IO.Path]::GetExtension($outputPath) -ine '.msix') { throw 'Output must have a .msix extension.' }
$outputDirectory = Split-Path -Parent $outputPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
$bundlePrefix = $bundlePath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if ($outputPath.StartsWith($bundlePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Output must be outside Bundle.'
}

$thumbprint = $null
$signing = $null
if (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
  $thumbprint = $CertificateThumbprint.Replace(' ', '').ToUpperInvariant()
  if ($thumbprint -notmatch '^[0-9A-F]{40}$') { throw 'CertificateThumbprint must be a 40-character SHA-1 thumbprint.' }
  $signing = Get-SigningCertificate $thumbprint $Publisher
}

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$iconPath = Join-Path $sourceRoot 'public\icons\icon-1024.png'
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) { throw 'The source application icon is missing.' }
$manifestTemplate = Join-Path $PSScriptRoot 'AppxManifest.template.xml'
if (-not (Test-Path -LiteralPath $manifestTemplate -PathType Leaf)) { throw 'The AppxManifest template is missing.' }
$sdk = Find-WindowsSdkTools

$work = Join-Path ([System.IO.Path]::GetTempPath()) ('tacticus-msix-' + [Guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $work 'PackageRoot'
$payload = Join-Path $packageRoot 'Payload'
$assets = Join-Path $packageRoot 'Assets'
$builtPackage = Join-Path $work 'TacticusAnalytics.msix'
try {
  New-Item -ItemType Directory -Path $payload -Force | Out-Null
  New-Item -ItemType Directory -Path $assets -Force | Out-Null
  foreach ($entry in (Get-ChildItem -LiteralPath $bundlePath -Force)) {
    Copy-Item -LiteralPath $entry.FullName -Destination $payload -Recurse -Force
  }

  [xml]$manifest = Get-Content -LiteralPath $manifestTemplate -Raw
  $namespace = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
  $namespace.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $identity = $manifest.SelectSingleNode('/f:Package/f:Identity', $namespace)
  if (-not $identity) { throw 'The AppxManifest template has no package Identity.' }
  $identity.SetAttribute('Publisher', $Publisher)
  $identity.SetAttribute('Version', $Version)
  $manifestPath = Join-Path $packageRoot 'AppxManifest.xml'
  $xmlSettings = [System.Xml.XmlWriterSettings]::new()
  $xmlSettings.Encoding = [System.Text.UTF8Encoding]::new($false)
  $xmlSettings.Indent = $true
  $xmlSettings.NewLineChars = "`r`n"
  $xmlWriter = [System.Xml.XmlWriter]::Create($manifestPath, $xmlSettings)
  try { $manifest.Save($xmlWriter) } finally { $xmlWriter.Dispose() }

  $sourceImage = [System.Drawing.Image]::FromFile($iconPath)
  try {
    if ($sourceImage.Width -ne $sourceImage.Height) { throw 'The source application icon must be square.' }
    Write-SquarePng $sourceImage 50 (Join-Path $assets 'StoreLogo.png')
    Write-SquarePng $sourceImage 150 (Join-Path $assets 'Square150x150Logo.png')
    Write-SquarePng $sourceImage 44 (Join-Path $assets 'Square44x44Logo.png')
  } finally {
    $sourceImage.Dispose()
  }

  & $sdk.MakeAppx pack /d $packageRoot /p $builtPackage /o
  if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed with exit code $LASTEXITCODE." }
  if ($signing) {
    $signArguments = @('sign', '/fd', 'SHA256', '/sha1', $thumbprint)
    if ($signing.MachineStore) { $signArguments += '/sm' }
    $signArguments += $builtPackage
    & $sdk.SignTool @signArguments
    if ($LASTEXITCODE -ne 0) { throw "SignTool failed with exit code $LASTEXITCODE." }
    & $sdk.SignTool verify /pa $builtPackage
    if ($LASTEXITCODE -ne 0) { throw "SignTool verification failed with exit code $LASTEXITCODE." }
  }
  Move-Item -LiteralPath $builtPackage -Destination $outputPath -Force
  Write-Output $outputPath
} finally {
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
