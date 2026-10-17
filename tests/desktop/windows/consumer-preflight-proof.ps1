param(
  [Parameter(Mandatory=$true)][string]$Root,
  [ValidateSet('All','Privilege','Payload','Manifest')][string]$Case = 'All'
)
$ErrorActionPreference = 'Stop'
$driver = Join-Path $PSScriptRoot 'installed-journey.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($driver, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Trusted qualification driver did not parse' }
$statements = $ast.EndBlock.Statements
foreach ($statement in $statements) {
  if ($statement -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
    Invoke-Expression $statement.Extent.Text
  }
}
$admission = @($statements | Where-Object {
  $_ -is [System.Management.Automation.Language.IfStatementAst] -and
  $_.Extent.Text.StartsWith('if ($StandardUser)') -and $_.Extent.Text.Contains('WindowsIdentity')
})[0].Extent.Text
# Exercise the actual trusted admission block with a synthetic OS identity.
# No accounts/groups/policy are changed, and no candidate executable is run.
$admission = $admission.Replace('[System.Environment]::UserInteractive', '$true').
  Replace('(Get-Process -Id $PID).SessionId', '1').
  Replace('[System.Security.Principal.WindowsIdentity]::GetCurrent()', '$script:TestIdentity')
$installedGate = @($statements | Where-Object {
  ($_ -is [System.Management.Automation.Language.AssignmentStatementAst] -or
   $_ -is [System.Management.Automation.Language.IfStatementAst]) -and
  ($_.Extent.Text.Contains('$installed/bundle-manifest.json') -or
   $_.Extent.Text.Contains('Installed candidate does not match the reviewed source'))
} | ForEach-Object { $_.Extent.Text }) -join "`n"
if (-not $admission -or -not $installedGate) { throw 'Qualification admission seam unavailable' }
$checks = 0
function Assert-Refused([scriptblock]$Action) {
  $refused = $false
  try { & $Action | Out-Null } catch { $refused = $true }
  if (-not $refused) { throw 'A negative consumer preflight control was accepted' }
  $script:checks++
}
function Invoke-Admission([string[]]$Groups) {
  $script:TestIdentity = [pscustomobject]@{
    Groups = @($Groups | ForEach-Object { [pscustomobject]@{ Value = $_; DenyOnly = $true } })
  }
  $script:TestIdentity | Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
  $StandardUser = $true
  Invoke-Expression $admission
  if (Get-Variable reviewedBundle -Scope Local -ErrorAction SilentlyContinue) { return $reviewedBundle }
}
function Invoke-Installed {
  $StandardUser = $true
  $installed = $script:InstalledRoot
  $reviewedBundle = $script:Reviewed
  Invoke-Expression $installedGate
}
function Save-Manifest([string]$Destination, $Value, [bool]$Compact = $false) {
  $text = if ($Compact) { $Value | ConvertTo-Json -Depth 8 -Compress } else { $Value | ConvertTo-Json -Depth 8 }
  [System.IO.File]::WriteAllText((Join-Path $Destination 'bundle-manifest.json'), $text, [System.Text.UTF8Encoding]::new($false))
  (Get-FileHash -LiteralPath (Join-Path $Destination 'bundle-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
}
$Bundle = Join-Path $Root 'candidate'
$script:InstalledRoot = Join-Path $Root 'installed'
$null = [System.IO.Directory]::CreateDirectory((Join-Path $Bundle 'nested'))
$launcher = Join-Path $Bundle 'TacticusDesktop.exe'
[System.IO.File]::WriteAllText($launcher, 'Synthetic inert launcher')
[System.IO.File]::WriteAllText((Join-Path $Bundle 'nested/fixture.txt'), 'Synthetic inert dependency')
$ExpectedSourceSha = 'a' * 40
$manifest = [ordered]@{
  schemaVersion = 1; platform = 'win-x64'; sourceSha = $ExpectedSourceSha
  files = @('TacticusDesktop.exe','nested/fixture.txt') | ForEach-Object {
    $file = Join-Path $Bundle $_
    [ordered]@{ path = $_; size = (Get-Item -LiteralPath $file).Length;
      sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
}
$ExpectedManifestSha256 = Save-Manifest $Bundle $manifest
$script:Reviewed = Invoke-Admission @('S-1-5-32-545')
$checks++
if ($Case -in @('All','Privilege')) {
  foreach ($sid in @('S-1-5-32-544','S-1-5-32-547')) {
    Assert-Refused { Invoke-Admission @('S-1-5-32-545', $sid) }
  }
}
if ($Case -in @('All','Payload')) {
  [System.IO.File]::WriteAllText($launcher, 'Synthetic changed bytes!')
  $marker = Join-Path $Root 'must-not-execute'
  Assert-Refused {
    Invoke-Admission @('S-1-5-32-545') | Out-Null
    [System.IO.File]::WriteAllText($marker, 'Unverified candidate would execute')
  }
  if (Test-Path -LiteralPath $marker) { throw 'Tampered launcher reached the execution boundary' }
  [System.IO.File]::WriteAllText($launcher, 'Synthetic inert launcher')
  [System.IO.File]::WriteAllText((Join-Path $Bundle 'undeclared.dll'), 'Synthetic extra file')
  Assert-Refused { Invoke-Admission @('S-1-5-32-545') }
  Remove-Item -LiteralPath (Join-Path $Bundle 'undeclared.dll')
}
if ($Case -in @('All','Manifest')) {
  Copy-Item -LiteralPath $Bundle -Destination $script:InstalledRoot -Recurse
  Invoke-Installed
  $checks++
  $compact = Save-Manifest $script:InstalledRoot $manifest $true
  if ($compact -ceq $ExpectedManifestSha256) { throw 'Serialization control did not change bytes' }
  Invoke-Installed
  $checks++
  $manifest.sourceSha = 'b' * 40
  $null = Save-Manifest $script:InstalledRoot $manifest
  Assert-Refused { Invoke-Installed }
  $manifest.sourceSha = $ExpectedSourceSha
  $manifest.files[0].sha256 = 'b' * 64
  $null = Save-Manifest $script:InstalledRoot $manifest
  Assert-Refused { Invoke-Installed }
}
@{ completed = $true; assertions = $checks; case = $Case; nativeStandardUser = $false; candidateExecuted = $false } | ConvertTo-Json -Compress
