using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
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
        // TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT; the reduced handle inherits these rights.
        if (!OpenProcessToken(new IntPtr(-1), 0x8B, out var original)) throw new Win32Exception();
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
                try { GrantUserDefaults(reduced, identity.User ?? throw new InvalidOperationException("User unavailable")); }
                catch { reduced.Dispose(); throw; }
                return reduced;
            }
            finally { foreach (var item in disabled) if (item.Sid != IntPtr.Zero) Marshal.FreeHGlobal(item.Sid); }
        }
    }
    // An elevated default DACL grants only Administrators and SYSTEM. With Administrators deny-only,
    // the reduced runtime could not reopen objects it creates, so grant the user as PostgreSQL does.
    private static void GrantUserDefaults(SafeAccessTokenHandle token, SecurityIdentifier user)
    {
        GetTokenInformation(token, 6, IntPtr.Zero, 0, out var needed);
        var current = Marshal.AllocHGlobal(checked((int)Math.Max(needed, (uint)IntPtr.Size)));
        try
        {
            if (!GetTokenInformation(token, 6, current, needed, out _)) throw new Win32Exception();
            var existing = Marshal.ReadIntPtr(current);
            var acl = existing == IntPtr.Zero ? new RawAcl(GenericAcl.AclRevision, 1) : ReadAcl(existing);
            acl.InsertAce(0, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x10000000, user, false, null));
            var bytes = new byte[acl.BinaryLength]; acl.GetBinaryForm(bytes, 0);
            SetPointerInformation(token, 6, bytes);
            var owner = new byte[user.BinaryLength]; user.GetBinaryForm(owner, 0);
            SetPointerInformation(token, 4, owner);
        }
        finally { Marshal.FreeHGlobal(current); }
    }
    private static RawAcl ReadAcl(IntPtr pointer)
    {
        var size = (ushort)Marshal.ReadInt16(pointer, 2);
        var bytes = new byte[size]; Marshal.Copy(pointer, bytes, 0, size);
        return new RawAcl(bytes, 0);
    }
    // TOKEN_DEFAULT_DACL and TOKEN_OWNER each hold one pointer to the value that follows it.
    private static void SetPointerInformation(SafeAccessTokenHandle token, int informationClass, byte[] value)
    {
        var size = IntPtr.Size + value.Length;
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.Copy(value, 0, buffer + IntPtr.Size, value.Length);
            Marshal.WriteIntPtr(buffer, buffer + IntPtr.Size);
            if (!SetTokenInformation(token, informationClass, buffer, (uint)size)) throw new Win32Exception();
        }
        finally { Marshal.FreeHGlobal(buffer); }
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
    private static extern bool GetTokenInformation(SafeAccessTokenHandle token, int informationClass, IntPtr information, uint length, out uint returned);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetTokenInformation(SafeAccessTokenHandle token, int informationClass, IntPtr information, uint length);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CreateRestrictedToken(SafeAccessTokenHandle existing, uint flags, uint disableCount,
        [In] SidAndAttributes[] disabled, uint deleteCount, IntPtr deleted, uint restrictCount, IntPtr restricted,
        out SafeAccessTokenHandle token);
}
