using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Desktop.Windows;

internal sealed record PackageRuntime(string PackageRoot, string Payload)
{
    private const int ErrorInsufficientBuffer = 122;
    private const int AppModelErrorNoPackage = 15700;

    public static PackageRuntime? Current()
    {
        uint length = 0;
        var status = GetCurrentPackagePath(ref length, null);
        if (status == AppModelErrorNoPackage) return null;
        if (status != ErrorInsufficientBuffer) throw new Win32Exception(status);
        if (length == 0) throw new InvalidOperationException("Packaged runtime path is unavailable");

        var buffer = new StringBuilder(checked((int)length));
        status = GetCurrentPackagePath(ref length, buffer);
        if (status != 0) throw new Win32Exception(status);

        var packageRoot = Normalize(buffer.ToString());
        var payload = Normalize(Path.Combine(packageRoot, "Payload"));
        if (!string.Equals(Normalize(AppContext.BaseDirectory), payload, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Packaged runtime payload location is invalid");
        return new PackageRuntime(packageRoot, payload);
    }

    public static bool IsUnpackagedOnlyVerb(string verb) => verb is
        "install" or
        "setup-candidate" or
        "uninstall-candidate" or
        "finish-uninstall" or
        "run-installed-candidate" or
        "install-candidate" or
        "rollback" or
        "run-candidate";

    private static string Normalize(string path) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int GetCurrentPackagePath(ref uint pathLength, StringBuilder? packagePath);
}
