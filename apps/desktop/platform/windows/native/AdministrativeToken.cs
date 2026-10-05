using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Desktop.Windows;

// PostgreSQL refuses an enabled Administrators SID. Retain the current user,
// profile and environment while removing administrative access from children.
internal static class AdministrativeToken
{
    public static SafeAccessTokenHandle? ReduceCurrent()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        if (!principal.IsInRole(WindowsBuiltInRole.Administrator) && !principal.IsInRole(WindowsBuiltInRole.PowerUser)) return null;
        if (!OpenProcessToken(new IntPtr(-1), 0xB, out var original)) throw new Win32Exception();
        using (original)
        {
            var groups = new[] { WellKnownSidType.BuiltinAdministratorsSid, WellKnownSidType.BuiltinPowerUsersSid };
            var disabled = new SidAndAttributes[groups.Length];
            try
            {
                for (var i = 0; i < groups.Length; i++) disabled[i] = AllocateSid(new SecurityIdentifier(groups[i], null));
                // DISABLE_MAX_PRIVILEGE keeps only SeChangeNotifyPrivilege.
                // No SANDBOX_INERT, policy modification or permission fallback.
                if (!CreateRestrictedToken(original, 1, (uint)disabled.Length, disabled, 0, IntPtr.Zero,
                        0, IntPtr.Zero, out var reduced)) throw new Win32Exception();
                return reduced;
            }
            finally { foreach (var item in disabled) if (item.Sid != IntPtr.Zero) Marshal.FreeHGlobal(item.Sid); }
        }
    }
    private static SidAndAttributes AllocateSid(SecurityIdentifier sid)
    {
        var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
        var pointer = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, pointer, bytes.Length);
        return new SidAndAttributes { Sid = pointer };
    }
    [StructLayout(LayoutKind.Sequential)] internal struct SidAndAttributes
    { public IntPtr Sid; public uint Attributes; }
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CreateRestrictedToken(SafeAccessTokenHandle existing, uint flags, uint disableCount,
        [In] SidAndAttributes[] disabled, uint deleteCount, IntPtr deleted, uint restrictCount, IntPtr restricted,
        out SafeAccessTokenHandle token);
}
