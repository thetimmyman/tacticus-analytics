using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Desktop.Windows;

internal static class PackageMutationProof
{
    private const uint GenericWrite = 0x40000000;
    private const uint Delete = 0x00010000;
    private const uint WriteDac = 0x00040000;
    private const uint WriteOwner = 0x00080000;
    private const uint ShareAll = 0x00000007;
    private const uint CreateNew = 1;
    private const uint OpenExisting = 3;
    private const uint BackupSemantics = 0x02000000;
    private const int AccessDenied = 5;

    public static void Run(string payload, string evidencePath)
    {
        if (AdministrativeToken.CurrentIntegrity() != 0x2000)
            throw new InvalidOperationException("Package proof child is not medium integrity");

        var existing = Path.Combine(payload, "package-integrity-canary.txt");
        if (!File.Exists(existing)) throw new InvalidOperationException("Package proof target is unavailable");
        var outside = Path.Combine(Path.GetTempPath(), "Tacticus-package-proof-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(outside);
        var external = Path.Combine(outside, "outside.txt");
        File.WriteAllText(external, "synthetic package integrity proof");
        var suffix = Guid.NewGuid().ToString("N");
        var assertions = new List<string> { "package-child-medium-integrity" };
        try
        {
            var package = PackageRuntime.Current() ?? throw new InvalidOperationException("Package proof identity is unavailable");
            if (!string.Equals(package.Payload, Path.GetFullPath(payload), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Package proof identity changed");
            assertions.Add("package-descendant-retains-package-identity");
            RequireCreateDenied(Path.Combine(payload, "proof-create-" + suffix), assertions);
            RequireOpenDenied(existing, GenericWrite, false, "package-existing-write-open-refused", assertions);
            RequireOpenDenied(existing, Delete, false, "package-existing-delete-refused", assertions);
            RequireExistingRenameDenied(existing, Path.Combine(payload, "proof-renamed-" + suffix), assertions);
            RequireRenameInDenied(external, Path.Combine(payload, "proof-rename-in-" + suffix), assertions);
            RequireHardlinkDenied(external, Path.Combine(payload, "proof-hardlink-" + suffix), assertions);
            RequireSymlinkDenied(external, outside, Path.Combine(payload, "proof-symlink-" + suffix), assertions);
            RequireOpenDenied(payload, WriteDac, true, "package-payload-write-dac-refused", assertions);
            RequireOpenDenied(payload, WriteOwner, true, "package-payload-write-owner-refused", assertions);
            File.WriteAllText(Path.GetFullPath(evidencePath), JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                platform = "win-x64",
                packaged = true,
                assertions
            }, new JsonSerializerOptions { WriteIndented = true }));
        }
        finally { Directory.Delete(outside, true); }
    }

    private static void RequireCreateDenied(string path, List<string> assertions)
    {
        using var handle = CreateFileW(path, GenericWrite, ShareAll, IntPtr.Zero, CreateNew, 0, IntPtr.Zero);
        var error = Marshal.GetLastWin32Error();
        if (!handle.IsInvalid)
        {
            handle.Dispose();
            if (!DeleteFileW(path)) throw new InvalidOperationException("Package proof cleanup failed");
            throw new InvalidOperationException("Package allowed file creation");
        }
        RequireAccessDenied(error);
        assertions.Add("package-new-file-create-refused");
    }

    private static void RequireOpenDenied(string path, uint access, bool directory, string assertion, List<string> assertions)
    {
        using var handle = CreateFileW(path, access, ShareAll, IntPtr.Zero, OpenExisting, directory ? BackupSemantics : 0, IntPtr.Zero);
        var error = Marshal.GetLastWin32Error();
        if (!handle.IsInvalid) throw new InvalidOperationException("Package allowed mutation access");
        RequireAccessDenied(error);
        assertions.Add(assertion);
    }

    private static void RequireExistingRenameDenied(string source, string destination, List<string> assertions)
    {
        if (MoveFileExW(source, destination, 0))
        {
            if (!MoveFileExW(destination, source, 0))
                throw new InvalidOperationException("Package proof cleanup failed");
            throw new InvalidOperationException("Package allowed existing file rename");
        }
        RequireAccessDenied(Marshal.GetLastWin32Error());
        assertions.Add("package-existing-rename-refused");
    }

    private static void RequireRenameInDenied(string source, string destination, List<string> assertions)
    {
        if (MoveFileExW(source, destination, 0))
        {
            if (!MoveFileExW(destination, source, 0))
                throw new InvalidOperationException("Package proof cleanup failed");
            throw new InvalidOperationException("Package allowed rename into payload");
        }
        RequireAccessDenied(Marshal.GetLastWin32Error());
        assertions.Add("package-rename-in-refused");
    }

    private static void RequireHardlinkDenied(string source, string destination, List<string> assertions)
    {
        if (CreateHardLinkW(destination, source, IntPtr.Zero))
        {
            if (!DeleteFileW(destination)) throw new InvalidOperationException("Package proof cleanup failed");
            throw new InvalidOperationException("Package allowed hardlink into payload");
        }
        RequireAccessDenied(Marshal.GetLastWin32Error());
        assertions.Add("package-hardlink-in-refused");
    }

    private static void RequireSymlinkDenied(string source, string outside, string destination, List<string> assertions)
    {
        var control = Path.Combine(outside, "control-link-" + Guid.NewGuid().ToString("N"));
        if (CreateSymbolicLinkW(control, source, 2) == 0)
            throw new InvalidOperationException("Package reparse proof control unavailable");
        if (!DeleteFileW(control)) throw new InvalidOperationException("Package proof cleanup failed");

        if (CreateSymbolicLinkW(destination, source, 2) != 0)
        {
            if (!DeleteFileW(destination)) throw new InvalidOperationException("Package proof cleanup failed");
            throw new InvalidOperationException("Package allowed reparse creation");
        }
        RequireAccessDenied(Marshal.GetLastWin32Error());
        assertions.Add("package-symlink-reparse-create-refused");
    }

    private static void RequireAccessDenied(int error)
    {
        if (error != AccessDenied) throw new Win32Exception(error);
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool DeleteFileW(string path);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool MoveFileExW(string existing, string destination, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLinkW(string newName, string existing, IntPtr security);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern byte CreateSymbolicLinkW(string symlink, string target, uint flags);
}
