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
$nodeCategory = if ($NoNodeLaunch) { 'not-applicable' } else { 'diagnostic-unavailable' }
$nodeOutcome = if ($NoNodeLaunch) { 'not-applicable' } else { 'unavailable' }
if ($nodeDiagnosticPath -and (Test-Path -LiteralPath $nodeDiagnosticPath -PathType Leaf)) {
  try {
    $nodeEvidence = Get-Content -LiteralPath $nodeDiagnosticPath -Raw | ConvertFrom-Json
    if ($nodeEvidence.schemaVersion -eq 1 -and $nodeEvidence.platform -eq 'win-x64' -and
        @('completed', 'failed').Contains([string]$nodeEvidence.outcome) -and
        $allowedNodeCategories.Contains([string]$nodeEvidence.nodeLaunchFailureCategory)) {
      $nodeCategory = [string]$nodeEvidence.nodeLaunchFailureCategory
      $nodeOutcome = [string]$nodeEvidence.outcome
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
} | ConvertTo-Json | Set-Content -LiteralPath $evidencePath -Encoding utf8

if ($activationFailed) {
  throw 'Packaged application activation failed; AUMID process exit code unavailable; Node launch category activation-failed'
}
if (-not $completed) {
  throw "Packaged application invocation failed; AUMID process exit code $exitCode; Node launch category $nodeCategory"
}
Write-Output $exitCode
