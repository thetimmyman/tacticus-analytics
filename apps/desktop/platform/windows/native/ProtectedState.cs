using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace Desktop.Windows;

internal sealed class ProtectedState : IDisposable
{
    private readonly FileStream lockHandle;
    public string Root { get; }
    public ProtectedState(string root)
    {
        Root = Path.GetFullPath(root);
        var sid = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("User unavailable");
        RejectReparseParents(Root);
        Directory.CreateDirectory(Root);
        var acl = new DirectorySecurity();
        acl.SetOwner(sid); acl.SetAccessRuleProtection(true, false);
        foreach (var identity in new[] { sid, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null) })
            acl.AddAccessRule(new FileSystemAccessRule(identity, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(Root).SetAccessControl(acl);
        RejectReparseParents(Root);
        try { lockHandle = new FileStream(Path.Combine(Root, "ownership.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { throw new InvalidOperationException("Workspace is already open"); }
    }
    public static void RejectReparseParents(string path)
    {
        for (var entry = Path.GetFullPath(path); !string.IsNullOrEmpty(entry); entry = Path.GetDirectoryName(entry))
            if ((File.Exists(entry) || Directory.Exists(entry)) && (File.GetAttributes(entry) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Reparse paths are unsupported");
    }
    public void Dispose() => lockHandle.Dispose();
}
