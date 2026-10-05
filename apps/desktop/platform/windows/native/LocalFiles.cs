using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Desktop.Windows;

internal static class LocalFiles
{
    private static string Choose(bool save)
    {
        var path = new StringBuilder(32768);
        var info = new OpenFileName { Size = Marshal.SizeOf<OpenFileName>(), File = path, MaxFile = (uint)path.Capacity,
            Filter = "Tacticus local projection (*.json)\0*.json\0\0", Title = save ? "Export retained personal projection" : "Import historical local projection",
            Extension = "json", Flags = 0x8 | 0x80000 | 0x800 | (save ? 0x2u : 0x1000u) };
        if (!(save ? GetSaveFileNameW(ref info) : GetOpenFileNameW(ref info))) throw new InvalidOperationException("File choice cancelled or unavailable");
        ProtectedState.RejectReparseParents(path.ToString()); return Path.GetFullPath(path.ToString());
    }
    internal static JsonDocument Validate(string value)
    {
        if (Encoding.UTF8.GetByteCount(value) > 4 * 1024 * 1024) throw new InvalidOperationException("Projection size limit");
        var json = JsonDocument.Parse(value);
        try
        {
            if (json.RootElement.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("Projection unavailable");
            Walk(json.RootElement);
            var allowed = new HashSet<string> { "version", "status", "personal", "capabilities", "freshness", "playerIdentity", "requestedCapabilities", "cloudContribution", "limitation" };
            if (json.RootElement.EnumerateObject().Any(property => !allowed.Contains(property.Name))) throw new InvalidOperationException("Unsupported projection field");
            return json;
        }
        catch { json.Dispose(); throw; }
    }
    private static void Walk(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Array) foreach (var item in element.EnumerateArray()) Walk(item);
        if (element.ValueKind != JsonValueKind.Object) return;
        foreach (var property in element.EnumerateObject())
        {
            var key = property.Name.Replace("_", "").ToLowerInvariant();
            if (new[] { "apikey", "credential", "secret", "sessiontoken", "authorization", "headers", "cookie", "vaultreferences" }.Contains(key))
                throw new InvalidOperationException("Credential-bearing imports and exports are unsupported");
            Walk(property.Value);
        }
    }
    public static string ChooseExport() => JsonSerializer.Serialize(new { destination = Choose(true) });
    private static void RequireSession(long expiresAt)
    {
        if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= expiresAt) throw new LocalSessionExpired();
    }
    public static string Export(string value, string destination, long expiresAt)
    {
        RequireSession(expiresAt);
        using var json = Validate(value);
        var path = Path.GetFullPath(destination);
        ProtectedState.RejectReparseParents(path);
        var temporary = Path.Combine(Path.GetDirectoryName(path)!, ".tacticus-projection-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                var sid = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("User unavailable");
                var acl = new FileSecurity(); acl.SetOwner(sid); acl.SetAccessRuleProtection(true, false);
                foreach (var identity in new[] { sid, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null) })
                    acl.AddAccessRule(new FileSystemAccessRule(identity, FileSystemRights.FullControl, AccessControlType.Allow));
                file.SetAccessControl(acl);
                var bytes = JsonSerializer.SerializeToUtf8Bytes(json.RootElement, new JsonSerializerOptions { WriteIndented = true });
                RequireSession(expiresAt);
                file.Write(bytes); file.Flush(true);
            }
            RequireSession(expiresAt);
            ProtectedState.RejectReparseParents(path);
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
        return JsonSerializer.Serialize(new { exported = true, filename = Path.GetFileName(path) });
    }
    public static string Import()
    {
        var path = Choose(false);
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length > 4 * 1024 * 1024) throw new InvalidOperationException("Projection size limit");
        using var reader = new StreamReader(file, Encoding.UTF8);
        using var json = Validate(reader.ReadToEnd());
        return json.RootElement.GetRawText();
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct OpenFileName
    {
        public int Size; public IntPtr Owner, Instance; public string? Filter, CustomFilter;
        public uint MaxCustomFilter, FilterIndex; public StringBuilder? File; public uint MaxFile;
        public string? FileTitle; public uint MaxFileTitle; public string? InitialDirectory, Title;
        public uint Flags; public ushort FileOffset, ExtensionOffset; public string? Extension;
        public IntPtr CustomData, Hook; public string? Template; public IntPtr Reserved; public uint Reserved2, FlagsEx;
    }
    [DllImport("comdlg32.dll", CharSet = CharSet.Unicode)] private static extern bool GetOpenFileNameW(ref OpenFileName info);
    [DllImport("comdlg32.dll", CharSet = CharSet.Unicode)] private static extern bool GetSaveFileNameW(ref OpenFileName info);
}

internal sealed class LocalSessionExpired : InvalidOperationException
{
    public LocalSessionExpired() : base("Unlock your local workspace to continue.") { }
}
