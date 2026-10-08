using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Desktop.Windows;

// Reuse only this owner's existing station/desktop. Borrowed handles remain
// owned by Windows; no desktop discovery, ACL modification or fallback.
internal static class OwnerDesktop
{
    public static string Current() => Name(GetProcessWindowStation()) + "\\" + Name(GetThreadDesktop(GetCurrentThreadId()));
    private static string Name(IntPtr handle)
    {
        if (handle == IntPtr.Zero) throw new Win32Exception();
        GetUserObjectInformationW(handle, 2, null, 0, out var bytes);
        if (bytes is < 2 or > 8192) throw new InvalidOperationException("Current Windows desktop unavailable");
        var buffer = new StringBuilder(checked((int)bytes / 2));
        if (!GetUserObjectInformationW(handle, 2, buffer, bytes, out _)) throw new Win32Exception();
        var name = buffer.ToString();
        if (name.Length == 0 || name.Any(ch => char.IsControl(ch) || ch is '\\' or '/'))
            throw new InvalidOperationException("Current Windows desktop unavailable");
        return name;
    }
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder? buffer, uint length, out uint needed);
}
