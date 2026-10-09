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
                try {
                    GrantUserDefaults(reduced, identity.User ?? throw new InvalidOperationException("User unavailable"));
                    // Disabling privileged SIDs does not lower a high integrity label.
                    // Give the child the ordinary interactive medium label explicitly.
                    SetMediumIntegrity(reduced);
                }
                catch { reduced.Dispose(); throw; }
                return reduced;
            }
            finally { foreach (var item in disabled) if (item.Sid != IntPtr.Zero) Marshal.FreeHGlobal(item.Sid); }
        }
    }
    internal static int CurrentIntegrity()
    {
        if (!OpenProcessToken(new IntPtr(-1), 0x8, out var token)) throw new Win32Exception();
        using (token) return Integrity(token);
    }
    private static int Integrity(SafeAccessTokenHandle token)
    {
        GetTokenInformation(token, 25, IntPtr.Zero, 0, out var needed);
        var buffer = Marshal.AllocHGlobal(checked((int)needed));
        try
        {
            if (!GetTokenInformation(token, 25, buffer, needed, out _)) throw new Win32Exception();
            var sid = new SecurityIdentifier(Marshal.ReadIntPtr(buffer));
            if (!sid.Value.StartsWith("S-1-16-", StringComparison.Ordinal))
                throw new InvalidOperationException("Unexpected token integrity label");
            return int.Parse(sid.Value[7..], System.Globalization.CultureInfo.InvariantCulture);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static void SetMediumIntegrity(SafeAccessTokenHandle token)
    {
        var sid = new SecurityIdentifier("S-1-16-8192");
        var label = AllocateSid(sid);
        label.Attributes = 0x20; // SE_GROUP_INTEGRITY
        var buffer = Marshal.AllocHGlobal(Marshal.SizeOf<SidAndAttributes>());
        try
        {
            Marshal.StructureToPtr(label, buffer, false);
            if (!SetTokenInformation(token, 25, buffer, checked((uint)(Marshal.SizeOf<SidAndAttributes>() + sid.BinaryLength))))
                throw new Win32Exception();
            if (Integrity(token) != 0x2000)
                throw new InvalidOperationException("Reduced token did not retain medium integrity");
        }
        finally { Marshal.FreeHGlobal(buffer); Marshal.FreeHGlobal(label.Sid); }
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
