using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Desktop.Windows;

// Creates package directories with a protected DACL from the first kernel
// operation. NTFS checks the parent's DACL when a child is created, so the
// directories admit the owner's add rights only while staging. Seal() rewrites
// every directory DACL through its creator handle (opened with WRITE_DAC),
// removes the add rights, and closes the creator handles before verification.
// Anything inserted during staging is rejected by the exact-inventory check
// that follows; nothing can be inserted after Seal().
internal sealed class SealedDirectoryTree : IDisposable
{
    private const uint FileListDirectory = 0x0001;
    private const uint FileAddFile = 0x0002;
    private const uint FileAddSubdirectory = 0x0004;
    private const uint FileTraverse = 0x0020;
    private const uint FileReadAttributes = 0x0080;
    private const uint Delete = 0x00010000;
    private const uint ReadControl = 0x00020000;
    private const uint WriteDac = 0x00040000;
    private const uint Synchronize = 0x00100000;
    // Explicit rights: NtCreateFile with synchronous I/O requires SYNCHRONIZE, which generic rights do not reliably supply here.
    private const uint FileGenericRead = 0x00120089;
    private const uint FileGenericWrite = 0x00120116;
    private const uint FileShareRead = 0x1;
    private const uint FileShareWrite = 0x2;
    private const uint FileShareDelete = 0x4;
    private const uint FileCreate = 0x2;
    private const uint FileDirectoryFile = 0x1;
    private const uint FileSynchronousIoNonalert = 0x20;
    private const uint FileOpenReparsePoint = 0x00200000;
    private const uint ObjCaseInsensitive = 0x40;
    private const uint DaclSecurityInformation = 0x4;
    private const uint ProtectedDaclSecurityInformation = 0x80000000;

    private readonly SecurityIdentifier owner;
    private readonly Dictionary<string, SafeFileHandle> creatorHandles = new(StringComparer.OrdinalIgnoreCase);
    private bool sealedTree;

    private SealedDirectoryTree(string root)
    {
        Root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        owner = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("User unavailable");
        ProtectedState.RejectReparseParents(Path.GetDirectoryName(Root)!);
        creatorHandles.Add("", CreateDirectory(Root, BuildDirectorySecurity(true)));
    }

    public string Root { get; }

    public static SealedDirectoryTree Create(string root) => new(root);

    public void EnsureDirectory(string relative)
    {
        if (sealedTree) throw new InvalidOperationException("Package directory tree is sealed");
        var current = "";
        foreach (var segment in relative.Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar)
            .Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            var child = current.Length == 0 ? segment : Path.Combine(current, segment);
            if (!creatorHandles.ContainsKey(child))
                creatorHandles.Add(child, CreateDirectory(creatorHandles[current], segment, BuildDirectorySecurity(true)));
            current = child;
        }
    }

    public FileStream CreateFile(string relative)
    {
        if (sealedTree) throw new InvalidOperationException("Package directory tree is complete");
        var normalized = relative.Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);
        var parent = Path.GetDirectoryName(normalized) ?? "";
        EnsureDirectory(parent);
        var descriptor = BuildFileSecurity().GetSecurityDescriptorBinaryForm();
        var pin = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try
        {
            var status = CreateRelative(creatorHandles[parent], Path.GetFileName(normalized),
                FileGenericRead | FileGenericWrite, FileShareRead, FileCreate,
                FileSynchronousIoNonalert | 0x40 | FileOpenReparsePoint,
                pin.AddrOfPinnedObject(), out var raw);
            if (status < 0) throw NativeError(status);
            return new FileStream(new SafeFileHandle(raw, true), FileAccess.ReadWrite);
        }
        finally { pin.Free(); }
    }

    public bool TryOpenAddCapabilityForProof()
    {
        using var handle = CreateFileW(NativePath(Root), FileAddFile | FileAddSubdirectory | FileListDirectory,
            FileShareRead | FileShareWrite | FileShareDelete, IntPtr.Zero, 3,
            FileOpenReparsePoint | 0x02000000, IntPtr.Zero);
        return !handle.IsInvalid;
    }

    public static bool TryCreateHardLinkForProof(string link, string existing) =>
        CreateHardLinkW(NativePath(link), NativePath(existing), IntPtr.Zero);

    public void Seal()
    {
        if (sealedTree) return;
        sealedTree = true;
        var descriptor = BuildDirectorySecurity(false).GetSecurityDescriptorBinaryForm();
        var pin = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try
        {
            foreach (var handle in creatorHandles.Values)
            {
                var status = NtSetSecurityObject(handle.DangerousGetHandle(), DaclSecurityInformation | ProtectedDaclSecurityInformation,
                    pin.AddrOfPinnedObject());
                if (status < 0) throw NativeError(status);
            }
        }
        finally
        {
            pin.Free();
            // No add-capable handle survives into verification or execution.
            Dispose();
        }
    }

    public static void RequireSealed(string path, bool directory)
    {
        var owner = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("User unavailable");
        FileSystemSecurity security = directory
            ? FileSystemAclExtensions.GetAccessControl(new DirectoryInfo(path), AccessControlSections.Access | AccessControlSections.Owner)
            : FileSystemAclExtensions.GetAccessControl(new FileInfo(path), AccessControlSections.Access | AccessControlSections.Owner);
        if (!security.AreAccessRulesProtected || !owner.Equals(security.GetOwner(typeof(SecurityIdentifier))))
            throw new InvalidOperationException("Package ACL is not sealed");
        var ownerRights = new SecurityIdentifier("S-1-3-4");
        var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        var blocked = FileSystemRights.CreateFiles | FileSystemRights.CreateDirectories |
            FileSystemRights.WriteData | FileSystemRights.AppendData | FileSystemRights.WriteAttributes |
            FileSystemRights.WriteExtendedAttributes | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
        var ownerDeny = false;
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, false, typeof(SecurityIdentifier)))
        {
            var sid = (SecurityIdentifier)rule.IdentityReference;
            if (sid.Equals(ownerRights) && rule.AccessControlType == AccessControlType.Deny &&
                (rule.FileSystemRights & (FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership)) ==
                (FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership)) ownerDeny = true;
            if (rule.AccessControlType == AccessControlType.Allow && !sid.Equals(system) && (rule.FileSystemRights & blocked) != 0)
                throw new InvalidOperationException("Package ACL permits executable-input mutation");
            if (!sid.Equals(owner) && !sid.Equals(ownerRights) && !sid.Equals(system) && rule.AccessControlType == AccessControlType.Allow)
                throw new InvalidOperationException("Package ACL grants an unexpected principal");
        }
        if (!ownerDeny) throw new InvalidOperationException("Package owner can replace its sealed ACL");
    }

    private DirectorySecurity BuildDirectorySecurity(bool staging)
    {
        var security = new DirectorySecurity();
        security.SetOwner(owner);
        security.SetAccessRuleProtection(true, false);
        var ownerRights = new SecurityIdentifier("S-1-3-4");
        // The permission-change denial is added at sealing; while staging, the
        // creator handles must still be able to create children with explicit ACLs.
        if (!staging)
            security.AddAccessRule(new FileSystemAccessRule(ownerRights,
                FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None, AccessControlType.Deny));
        var current = FileSystemRights.ReadAndExecute | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles;
        if (staging) current |= FileSystemRights.CreateFiles | FileSystemRights.CreateDirectories;
        security.AddAccessRule(new FileSystemAccessRule(owner, current, InheritanceFlags.None, PropagationFlags.None, AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(owner,
            FileSystemRights.ReadAndExecute | FileSystemRights.Delete,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.InheritOnly, AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None, AccessControlType.Allow));
        return security;
    }

    private FileSecurity BuildFileSecurity()
    {
        var security = new FileSecurity();
        security.SetOwner(owner);
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-3-4"),
            FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership, AccessControlType.Deny));
        security.AddAccessRule(new FileSystemAccessRule(owner,
            FileSystemRights.ReadAndExecute | FileSystemRights.Delete, AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            FileSystemRights.FullControl, AccessControlType.Allow));
        return security;
    }

    private static SafeFileHandle CreateDirectory(string path, DirectorySecurity security)
    {
        var descriptor = security.GetSecurityDescriptorBinaryForm();
        var descriptorPin = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        var nameBuffer = Marshal.StringToHGlobalUni(NtPath(path));
        var unicodePointer = Marshal.AllocHGlobal(Marshal.SizeOf<UnicodeString>());
        try
        {
            var nativeName = NtPath(path);
            var unicode = new UnicodeString
            {
                Length = checked((ushort)(nativeName.Length * 2)),
                MaximumLength = checked((ushort)((nativeName.Length + 1) * 2)),
                Buffer = nameBuffer
            };
            Marshal.StructureToPtr(unicode, unicodePointer, false);
            var attributes = new ObjectAttributes
            {
                Length = Marshal.SizeOf<ObjectAttributes>(),
                ObjectName = unicodePointer,
                Attributes = ObjCaseInsensitive,
                SecurityDescriptor = descriptorPin.AddrOfPinnedObject()
            };
            var status = NtCreateFile(out var raw,
                FileListDirectory | FileAddFile | FileAddSubdirectory | FileTraverse | FileReadAttributes |
                ReadControl | WriteDac | Synchronize,
                ref attributes, out _, IntPtr.Zero, 0x80,
                FileShareRead | FileShareWrite, FileCreate,
                FileDirectoryFile | FileSynchronousIoNonalert | FileOpenReparsePoint, IntPtr.Zero, 0);
            if (status < 0) throw NativeError(status);
            return new SafeFileHandle(raw, true);
        }
        finally
        {
            Marshal.FreeHGlobal(unicodePointer);
            Marshal.FreeHGlobal(nameBuffer);
            descriptorPin.Free();
        }
    }

    private static SafeFileHandle CreateDirectory(SafeFileHandle parent, string name, DirectorySecurity security)
    {
        var descriptor = security.GetSecurityDescriptorBinaryForm();
        var pin = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try
        {
            var status = CreateRelative(parent, name,
                FileListDirectory | FileAddFile | FileAddSubdirectory | FileTraverse | FileReadAttributes |
                ReadControl | WriteDac | Synchronize,
                FileShareRead | FileShareWrite, FileCreate,
                FileDirectoryFile | FileSynchronousIoNonalert | FileOpenReparsePoint,
                pin.AddrOfPinnedObject(), out var raw);
            if (status < 0) throw NativeError(status);
            return new SafeFileHandle(raw, true);
        }
        finally { pin.Free(); }
    }

    private static int CreateRelative(SafeFileHandle directory, string name, uint access, uint sharing,
        uint disposition, uint options, IntPtr descriptor, out IntPtr raw)
    {
        var nameBuffer = Marshal.StringToHGlobalUni(name);
        var unicodePointer = Marshal.AllocHGlobal(Marshal.SizeOf<UnicodeString>());
        try
        {
            var unicode = new UnicodeString { Length = checked((ushort)(name.Length * 2)), MaximumLength = checked((ushort)((name.Length + 1) * 2)), Buffer = nameBuffer };
            Marshal.StructureToPtr(unicode, unicodePointer, false);
            var attributes = new ObjectAttributes
            {
                Length = Marshal.SizeOf<ObjectAttributes>(), RootDirectory = directory.DangerousGetHandle(),
                ObjectName = unicodePointer, Attributes = ObjCaseInsensitive, SecurityDescriptor = descriptor
            };
            return NtCreateFile(out raw, access, ref attributes, out _, IntPtr.Zero, 0x80, sharing,
                disposition, options, IntPtr.Zero, 0);
        }
        finally { Marshal.FreeHGlobal(unicodePointer); Marshal.FreeHGlobal(nameBuffer); }
    }

    internal static string NtPath(string path)
    {
        var full = Path.GetFullPath(path);
        if (full.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\??\UNC\" + full[8..];
        if (full.StartsWith(@"\\?\", StringComparison.Ordinal)) return @"\??\" + full[4..];
        return full.StartsWith(@"\\", StringComparison.Ordinal) ? @"\??\UNC\" + full[2..] : @"\??\" + full;
    }

    private static string NativePath(string path)
    {
        var full = Path.GetFullPath(path);
        return full.StartsWith(@"\\?\", StringComparison.Ordinal) ? full :
            full.StartsWith(@"\\", StringComparison.Ordinal) ? @"\\?\UNC\" + full[2..] : @"\\?\" + full;
    }

    private static Win32Exception NativeError(int status) => new(unchecked((int)RtlNtStatusToDosError(status)));

    public void Dispose()
    {
        foreach (var handle in creatorHandles.Values.Reverse()) handle.Dispose();
        creatorHandles.Clear();
    }

    [StructLayout(LayoutKind.Sequential)] private struct UnicodeString { public ushort Length, MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] private struct ObjectAttributes
    {
        public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes;
        public IntPtr SecurityDescriptor, SecurityQualityOfService;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoStatusBlock { public IntPtr Status; public UIntPtr Information; }
    [DllImport("ntdll.dll")] private static extern int NtCreateFile(out IntPtr handle, uint access,
        ref ObjectAttributes attributes, out IoStatusBlock status, IntPtr allocationSize, uint fileAttributes,
        uint shareAccess, uint createDisposition, uint createOptions, IntPtr eaBuffer, uint eaLength);
    [DllImport("ntdll.dll")] private static extern int NtSetSecurityObject(IntPtr handle, uint information, IntPtr descriptor);
    [DllImport("ntdll.dll")] private static extern uint RtlNtStatusToDosError(int status);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLinkW(string link, string existing, IntPtr security);
}
