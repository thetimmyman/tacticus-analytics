$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Licensed build-tool redistributable payload unavailable' }
# Marker directories such as v145 need not contain an x64 payload.
$crt = Get-ChildItem -LiteralPath (Join-Path $vs 'VC/Redist/MSVC') -Directory -Recurse -Depth 3 |
  Where-Object { $_.Name -match '^Microsoft\.VC\d+\.CRT$' -and $_.Parent.Name -eq 'x64' } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $crt) { throw 'Application-local Microsoft CRT payload unavailable' }
$dlls = @(Get-ChildItem -LiteralPath $crt.FullName -Filter '*.dll')
if ($dlls.Count -lt 3 -or $dlls.Count -gt 32) { throw 'Microsoft CRT inventory unavailable' }
foreach ($dll in $dlls) {
  $signature = Get-AuthenticodeSignature -LiteralPath $dll.FullName
  # A publisher can use different certificate common names. Its trusted organization must be Microsoft.
  $microsoft = $signature.SignerCertificate -and
    ($signature.SignerCertificate.Subject -split ',\s*' -contains 'O=Microsoft Corporation')
  Write-Host (@{ file = $dll.Name; signatureStatus = [string]$signature.Status; microsoftPublisher = [bool]$microsoft } | ConvertTo-Json -Compress)
  if ($signature.Status -ne 'Valid' -or -not $microsoft) {
    throw "Microsoft CRT publisher validation failed: $($dll.Name), $($signature.Status)"
  }
}
return $crt.FullName
