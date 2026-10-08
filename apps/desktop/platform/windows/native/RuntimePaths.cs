using System.Runtime.InteropServices;
using System.Text;

namespace Desktop.Windows;

internal static class RuntimePaths
{
    // initdb emits its installation path into UTF8 SQL using Windows ANSI bytes.
    // Keep the actual Unicode installation; use only its verified filesystem alias
    // for PostgreSQL. No OS policy is changed if short names are unavailable.
    public static string AsciiDirectory(string directory)
    {
        var original = Path.GetFullPath(directory);
        ProtectedState.RejectReparseParents(original);
        if (!Directory.Exists(original)) throw new InvalidOperationException("Bundled database directory unavailable");
        if (original.All(ch => ch <= 127)) return original;
        var shortName = new StringBuilder(32768);
        var size = GetShortPathNameW(original, shortName, (uint)shortName.Capacity);
        if (size == 0 || size >= shortName.Capacity || shortName.ToString().Any(ch => ch > 127))
            throw new InvalidOperationException("Bundled database needs an ASCII filesystem alias; full Unicode database path qualification remains open on this volume");
        var longName = new StringBuilder(32768);
        size = GetLongPathNameW(shortName.ToString(), longName, (uint)longName.Capacity);
        if (size == 0 || size >= longName.Capacity || !string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(longName.ToString())),
            Path.TrimEndingDirectorySeparator(original), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Bundled database filesystem alias did not match its verified directory");
        ProtectedState.RejectReparseParents(shortName.ToString());
        return shortName.ToString();
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetShortPathNameW(string source, StringBuilder output, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetLongPathNameW(string source, StringBuilder output, uint size);
}
