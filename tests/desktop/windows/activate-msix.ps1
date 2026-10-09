[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$PackageFamilyName,
  [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$Evidence,
  [string]$ApplicationId = 'TacticusDesktop',
  [AllowEmptyCollection()][AllowEmptyString()][string[]]$Arguments = @(),
  [string]$NodeDiagnostic,
  [switch]$NoNodeLaunch
)
$ErrorActionPreference = 'Stop'

if ($PackageFamilyName -match '[!\x00-\x1f]' -or $ApplicationId -notmatch '^[A-Za-z0-9._-]+$') {
  throw 'Invalid packaged application identity'
}

$runnerTemp = [System.IO.Path]::TrimEndingDirectorySeparator([System.IO.Path]::GetFullPath($env:RUNNER_TEMP))
$runnerPrefix = $runnerTemp + [System.IO.Path]::DirectorySeparatorChar
function Resolve-RunnerEvidencePath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Packaged activation evidence path is required' }
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($runnerPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Packaged activation evidence must be inside the runner temporary directory'
  }
  return $resolved
}
$evidencePath = Resolve-RunnerEvidencePath $Evidence
$nodeDiagnosticPath = if ($NoNodeLaunch) {
  if (-not [string]::IsNullOrWhiteSpace($NodeDiagnostic)) { throw 'Node diagnostic is invalid for a non-Node invocation' }
  $null
} else {
  Resolve-RunnerEvidencePath $NodeDiagnostic
}
[System.IO.File]::Delete($evidencePath)
if ($nodeDiagnosticPath) { [System.IO.File]::Delete($nodeDiagnosticPath) }

if (-not ('Tacticus.Windows.ApplicationActivationManager' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Tacticus.Windows
{
    [Flags]
    public enum ActivateOptions
    {
        None = 0,
        DesignMode = 1,
        NoErrorUi = 2,
        NoSplashScreen = 4
    }

    [ComImport]
    [Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IApplicationActivationManager
    {
        [PreserveSig]
        int ActivateApplication(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments,
            ActivateOptions options,
            out uint processId);
    }

    [ComImport]
    [Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
    public class ApplicationActivationManager
    {
    }

    public static class PackagedApplicationRunner
    {
        private const uint Synchronize = 0x00100000;
        private const uint ProcessQueryLimitedInformation = 0x00001000;
        private const uint Infinite = 0xffffffff;
        private const uint WaitObject0 = 0;

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        public static int Run(string appUserModelId, string arguments)
        {
            var manager = (IApplicationActivationManager)new ApplicationActivationManager();
            uint processId;
            try
            {
                int result = manager.ActivateApplication(
                    appUserModelId,
                    arguments,
                    ActivateOptions.NoErrorUi,
                    out processId);
                if (result < 0)
                {
                    Marshal.ThrowExceptionForHR(result);
                }
            }
            finally
            {
                Marshal.FinalReleaseComObject(manager);
            }

            if (processId == 0)
            {
                throw new InvalidOperationException("Packaged application activation returned no process");
            }

            IntPtr process = OpenProcess(Synchronize | ProcessQueryLimitedInformation, false, processId);
            if (process == IntPtr.Zero)
            {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }

            try
            {
                uint waitResult = WaitForSingleObject(process, Infinite);
                if (waitResult != WaitObject0)
                {
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                }

                uint exitCode;
                if (!GetExitCodeProcess(process, out exitCode))
                {
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                }

                return unchecked((int)exitCode);
            }
            finally
            {
                CloseHandle(process);
            }
        }
    }
}
'@
}

function ConvertTo-WindowsCommandLineArgument([string]$Value) {
  if ($Value.Contains([char]0)) { throw 'Activation argument contains a null character' }
  $result = [System.Text.StringBuilder]::new('"')
  $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq [char]92) { $slashes++; continue }
    $escapedSlashes = if ($character -eq [char]34) { $slashes * 2 + 1 } else { $slashes }
    $null = $result.Append([char]92, $escapedSlashes)
    $null = $result.Append($character)
    $slashes = 0
  }
  $null = $result.Append([char]92, $slashes * 2)
  $null = $result.Append([char]34)
  return $result.ToString()
}

$argumentLine = (@($Arguments) | ForEach-Object { ConvertTo-WindowsCommandLineArgument $_ }) -join ' '
$appUserModelId = "$PackageFamilyName!$ApplicationId"
$exitCode = $null
$activationFailed = $false
try {
  $exitCode = [Tacticus.Windows.PackagedApplicationRunner]::Run($appUserModelId, $argumentLine)
} catch {
  $activationFailed = $true
}

$allowedNodeCategories = @(
  'none',
  'launch-configuration-invalid',
  'schema-recovery-failed',
  'recovery-journey-failed',
  'service-startup-failed',
  'application-stopped-during-startup',
  'application-health-timeout',
  'window-verification-failed',
  'launch-assertion-failed',
  'launch-type-error',
  'launch-range-error',
  'launch-syntax-error',
  'launch-reference-error',
  'launch-aborted',
  'launch-timeout',
  'node-launch-unclassified'
)
$allowedServiceFailureCodes = @(
  'administrative-token-refused', 'loopback-bind-refused',
  'password-file-read-refused', 'data-directory-access-refused',
  'data-directory-create-refused', 'data-directory-permissions-refused',
  'bootstrap-input-read-refused', 'bootstrap-input-access-refused',
  'postgres-executable-unavailable',
  'postgres-executable-unavailable-access-denied',
  'own-executable-unavailable', 'own-executable-unavailable-access-denied',
  'process-token-refused', 'permission-refused', 'locale-unavailable',
  'required-file-unavailable', 'child-launch-failed',
  'postgres-executable-mismatch', 'dynamic-library-unavailable',
  'restricted-token-unavailable', 'shared-memory-unavailable',
  'system-memory-unavailable', 'random-source-unavailable',
  'bootstrap-syntax-error', 'bootstrap-encoding-invalid',
  'database-authority-refused', 'database-schema-unavailable',
  'database-function-unavailable', 'database-object-conflict',
  'database-authentication-refused', 'postgres-child-exit-1',
  'postgres-bootstrap-failed', 'unclassified-service-failure',
  'unavailable', 'not-applicable'
)
$allowedServiceBootstrapPhases = @(
  'post-bootstrap', 'bootstrap-script', 'configuration', 'time-zone',
  'shared-buffers', 'max-connections', 'shared-memory', 'subdirectories',
  'data-directory', 'preflight', 'bootstrap-phase-unavailable',
  'unavailable', 'not-applicable'
)
$allowedServiceExecutables = @(
  'initdb.exe', 'psql.exe', 'auth.exe', 'pg_ctl.exe', 'owned-service',
  'unavailable', 'not-applicable'
)
function ConvertTo-Uint32Evidence([object]$Value) {
  if ($null -eq $Value) { return $null }
  $jsonIntegerTypes = @(
    [byte], [sbyte], [int16], [uint16], [int32], [uint32], [int64], [uint64]
  )
  if ($jsonIntegerTypes -notcontains $Value.GetType()) { return $null }
  [uint64]$parsed = 0
  if ([uint64]::TryParse([string]$Value, [ref]$parsed) -and
      $parsed -le [uint32]::MaxValue) {
    return $parsed
  }
  return $null
}
$nodeCategory = if ($NoNodeLaunch) { 'not-applicable' } else { 'diagnostic-unavailable' }
$nodeOutcome = if ($NoNodeLaunch) { 'not-applicable' } else { 'unavailable' }
$nodeServiceFailureCode = 'not-applicable'
$nodeServiceBootstrapPhase = 'not-applicable'
$nodeServiceExecutable = 'not-applicable'
$nodeServiceExitCode = $null
$nodePostgresChildStatus = $null
if ($nodeDiagnosticPath -and (Test-Path -LiteralPath $nodeDiagnosticPath -PathType Leaf)) {
  try {
    $nodeEvidence = Get-Content -LiteralPath $nodeDiagnosticPath -Raw | ConvertFrom-Json
    $schemaVersion = ConvertTo-Uint32Evidence $nodeEvidence.schemaVersion
    $serviceExitCode = ConvertTo-Uint32Evidence $nodeEvidence.serviceExitCode
    $postgresChildStatus = ConvertTo-Uint32Evidence $nodeEvidence.postgresChildStatus
    $evidenceOutcome = [string]$nodeEvidence.outcome
    $evidenceCategory = [string]$nodeEvidence.nodeLaunchFailureCategory
    $evidenceFailureCode = [string]$nodeEvidence.serviceFailureCode
    $evidenceBootstrapPhase = [string]$nodeEvidence.serviceBootstrapPhase
    $evidenceExecutable = [string]$nodeEvidence.serviceExecutable
    $serviceFieldsNotApplicable =
      $evidenceFailureCode -eq 'not-applicable' -and
      $evidenceBootstrapPhase -eq 'not-applicable' -and
      $evidenceExecutable -eq 'not-applicable' -and
      $null -eq $nodeEvidence.serviceExitCode -and
      $null -eq $nodeEvidence.postgresChildStatus
    $diagnosticShapeValid =
      ($evidenceOutcome -eq 'completed' -and $evidenceCategory -eq 'none' -and
        $serviceFieldsNotApplicable) -or
      ($evidenceOutcome -eq 'failed' -and $evidenceCategory -eq 'service-startup-failed' -and
        $evidenceFailureCode -ne 'not-applicable' -and
        $evidenceExecutable -ne 'not-applicable') -or
      ($evidenceOutcome -eq 'failed' -and $evidenceCategory -ne 'none' -and
        $evidenceCategory -ne 'service-startup-failed' -and $serviceFieldsNotApplicable)
    if ($schemaVersion -eq 1 -and $nodeEvidence.platform -is [string] -and
        [string]$nodeEvidence.platform -ceq 'win-x64' -and
        $diagnosticShapeValid -and
        $allowedNodeCategories.Contains($evidenceCategory) -and
        $allowedServiceFailureCodes.Contains($evidenceFailureCode) -and
        $allowedServiceBootstrapPhases.Contains($evidenceBootstrapPhase) -and
        $allowedServiceExecutables.Contains($evidenceExecutable) -and
        ($null -eq $nodeEvidence.serviceExitCode -or $null -ne $serviceExitCode) -and
        ($null -eq $nodeEvidence.postgresChildStatus -or $null -ne $postgresChildStatus)) {
      $nodeCategory = $evidenceCategory
      $nodeOutcome = $evidenceOutcome
      $nodeServiceFailureCode = $evidenceFailureCode
      $nodeServiceBootstrapPhase = $evidenceBootstrapPhase
      $nodeServiceExecutable = $evidenceExecutable
      $nodeServiceExitCode = $serviceExitCode
      $nodePostgresChildStatus = $postgresChildStatus
    } else {
      $nodeCategory = 'diagnostic-invalid'
      $nodeOutcome = 'invalid'
    }
  } catch {
    $nodeCategory = 'diagnostic-invalid'
    $nodeOutcome = 'invalid'
  }
}

$completed = -not $activationFailed -and $exitCode -eq 0 -and
  ($NoNodeLaunch -or ($nodeOutcome -eq 'completed' -and $nodeCategory -eq 'none'))
@{
  schemaVersion = 1
  platform = 'win-x64'
  activation = 'application-user-model-id'
  completed = $completed
  childExitCode = $exitCode
  nodeLaunchOutcome = $(if ($activationFailed) { 'activation-failed' } else { $nodeOutcome })
  nodeLaunchFailureCategory = $(if ($activationFailed) { 'activation-failed' } else { $nodeCategory })
  serviceFailureCode = $nodeServiceFailureCode
  serviceBootstrapPhase = $nodeServiceBootstrapPhase
  serviceExecutable = $nodeServiceExecutable
  serviceExitCode = $nodeServiceExitCode
  postgresChildStatus = $nodePostgresChildStatus
} | ConvertTo-Json | Set-Content -LiteralPath $evidencePath -Encoding utf8

if ($activationFailed) {
  throw 'Packaged application activation failed; AUMID process exit code unavailable; Node launch category activation-failed'
}
if (-not $completed) {
  throw "Packaged application invocation failed; AUMID process exit code $exitCode; Node launch category $nodeCategory; service $nodeServiceExecutable; failure $nodeServiceFailureCode; phase $nodeServiceBootstrapPhase; service exit $nodeServiceExitCode; PostgreSQL child status $nodePostgresChildStatus"
}
Write-Output $exitCode
