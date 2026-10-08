using System.Security.Cryptography;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Desktop.Windows;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record BundleManifest(int SchemaVersion, string Platform, string SourceSha, BundleEntry[] Files);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record BundleEntry(string Path, long Size, string Sha256);

internal static class Bundle
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    public static BundleManifest Load(string root)
    {
        ProtectedState.RejectReparseParents(root);
        using var stream = new FileStream(System.IO.Path.Combine(root, "bundle-manifest.json"), FileMode.Open, FileAccess.Read, FileShare.Read);
        return ReadManifest(stream);
    }
    private static BundleManifest ReadManifest(Stream stream)
    {
        if (stream.Length > 4 * 1024 * 1024) throw new InvalidOperationException("Manifest limit");
        var manifest = JsonSerializer.Deserialize<BundleManifest>(stream, Options) ?? throw new InvalidOperationException("Missing manifest");
        if (manifest.SchemaVersion != 1 || manifest.Platform != "win-x64" || !IsHex(manifest.SourceSha, 40) ||
            manifest.Files.Length is 0 or > 20000) throw new InvalidOperationException("Unsupported manifest");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in manifest.Files)
        {
            ValidateRelative(entry.Path);
            if (!names.Add(entry.Path) || !IsHex(entry.Sha256, 64) || entry.Size is < 0 or > 2L * 1024 * 1024 * 1024)
                throw new InvalidOperationException("Invalid file inventory");
        }
        return manifest;
    }
    internal static bool IsHex(string value, int length) => value.Length == length && value.All(ch => ch is >= '0' and <= '9' or >= 'a' and <= 'f');
    internal static void ValidateRelative(string path)
    {
        if (path.Length is 0 or > 240 || path.Contains('\\') || path.Contains(':') || path.Contains('\0') || path.StartsWith('/'))
            throw new InvalidOperationException("Unsafe package path");
        foreach (var part in path.Split('/'))
        {
            var stem = part.Split('.')[0].ToUpperInvariant();
            if (part is "" or "." or ".." || part.EndsWith('.') || part.EndsWith(' ') || part.Any(ch => ch < 32 || "<>\"|?*".Contains(ch)) ||
                stem is "CON" or "PRN" or "AUX" or "NUL" ||
                (stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) && stem[3] is >= '0' and <= '9'))
                throw new InvalidOperationException("Unsafe package path");
        }
    }
    public static void Verify(string root, BundleManifest manifest)
    {
        var expected = manifest.Files.Select(entry => entry.Path).Append("bundle-manifest.json").ToHashSet(StringComparer.OrdinalIgnoreCase);
        var pending = new Stack<string>(); pending.Push(root);
        while (pending.Count != 0)
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(pending.Pop()))
            {
                ProtectedState.RejectReparseParents(path);
                if (Directory.Exists(path)) pending.Push(path);
                else if (!expected.Remove(System.IO.Path.GetRelativePath(root, path).Replace('\\', '/')))
                    throw new InvalidOperationException("Unexpected package file");
            }
        }
        if (expected.Count != 0) throw new InvalidOperationException("Missing package file");
        foreach (var entry in manifest.Files) CopyVerified(root, entry, null);
    }
    // Hold verified bytes and their directory names until the owned process tree
    // has stopped. A verification followed by closing the inputs leaves a race
    // where an update or another same-user process can replace executable code.
    public static VerifiedBundle PinVerified(string root)
    {
        root = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(root));
        var retained = new List<IDisposable>();
        var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        SafeFileHandle Pin(string path, bool directory)
        {
            var handle = CreateFileW(path, directory ? 0x80u : 0x80000000u, 1, IntPtr.Zero, 3,
                0x00200000u | (directory ? 0x02000000u : 0u), IntPtr.Zero);
            if (handle.IsInvalid) { handle.Dispose(); throw new Win32Exception(); }
            try
            {
                if (!GetFileInformationByHandleEx(handle, 9, out var attributes, (uint)Marshal.SizeOf<AttributeTag>()))
                    throw new Win32Exception();
                if ((attributes.Attributes & 0x400) != 0 || ((attributes.Attributes & 0x10) != 0) != directory)
                    throw new InvalidOperationException("Package entry is a reparse point or changed type");
                return handle;
            }
            catch { handle.Dispose(); throw; }
        }
        void PinDirectory(string path)
        {
            if (directories.Add(path)) retained.Add(Pin(path, true));
        }
        FileStream PinFile(string path)
        {
            var handle = Pin(path, false);
            try
            {
                var stream = new FileStream(handle, FileAccess.Read);
                retained.Add(stream);
                return stream;
            }
            catch { handle.Dispose(); throw; }
        }
        try
        {
            // Pin parents from the volume downward before resolving children.
            // Denying delete sharing also prevents ancestor-directory swaps.
            var ancestors = new Stack<string>();
            for (string? directory = root; directory is not null; directory = System.IO.Path.GetDirectoryName(directory))
                ancestors.Push(directory);
            while (ancestors.Count != 0) PinDirectory(ancestors.Pop());
            var manifest = ReadManifest(PinFile(System.IO.Path.Combine(root, "bundle-manifest.json")));
            var expected = manifest.Files.ToDictionary(entry => entry.Path, StringComparer.OrdinalIgnoreCase);
            var pending = new Stack<string>(); pending.Push(root);
            while (pending.Count != 0)
            {
                foreach (var path in Directory.EnumerateFileSystemEntries(pending.Pop()))
                {
                    if (Directory.Exists(path)) { PinDirectory(path); pending.Push(path); continue; }
                    var relative = System.IO.Path.GetRelativePath(root, path).Replace('\\', '/');
                    if (relative.Equals("bundle-manifest.json", StringComparison.OrdinalIgnoreCase)) continue;
                    if (!expected.Remove(relative, out var entry)) throw new InvalidOperationException("Unexpected package file");
                    var input = PinFile(path);
                    if (input.Length != entry.Size || Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant() != entry.Sha256)
                        throw new InvalidOperationException("Package content changed before activation");
                }
            }
            if (expected.Count != 0) throw new InvalidOperationException("Missing package file");
            return new VerifiedBundle(manifest, retained);
        }
        catch { foreach (var handle in retained.AsEnumerable().Reverse()) handle.Dispose(); throw; }
    }
    [StructLayout(LayoutKind.Sequential)] private struct AttributeTag { public uint Attributes, Tag; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind, out AttributeTag information, uint size);
    public static void CopyVerified(string root, BundleEntry entry, string? destination)
    {
        var path = System.IO.Path.Combine(root, entry.Path.Replace('/', System.IO.Path.DirectorySeparatorChar));
        ProtectedState.RejectReparseParents(path);
        // Windows FileShare.Read denies mutation and deletion for the entire verify/copy operation.
        using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length != entry.Size) throw new InvalidOperationException("Package size mismatch");
        var digest = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
        if (digest != entry.Sha256) throw new InvalidOperationException("Package digest mismatch");
        if (destination is null) return;
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(destination)!);
        using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        input.Position = 0; input.CopyTo(output); output.Flush(true);
    }
    public static string StageCandidate(string source, string installation)
    {
        var manifest = Load(source);
        using var owner = new ProtectedState(installation);
        var versions = System.IO.Path.Combine(owner.Root, "versions");
        Directory.CreateDirectory(versions);
        var id = manifest.SourceSha + "-" + Guid.NewGuid().ToString("N");
        var stage = System.IO.Path.Combine(versions, id + ".stage");
        var final = System.IO.Path.Combine(versions, id);
        Directory.CreateDirectory(stage);
        try
        {
            foreach (var entry in manifest.Files)
                CopyVerified(source, entry, System.IO.Path.Combine(stage, entry.Path.Replace('/', System.IO.Path.DirectorySeparatorChar)));
            File.WriteAllText(System.IO.Path.Combine(stage, "bundle-manifest.json"), JsonSerializer.Serialize(manifest, Options));
            Verify(stage, Load(stage));
            Directory.Move(stage, final);
            var pointer = System.IO.Path.Combine(owner.Root, "current.json");
            var previous = File.Exists(pointer) ? JsonDocument.Parse(File.ReadAllText(pointer)).RootElement.GetProperty("version").GetString() : null;
            AtomicWrite(pointer, JsonSerializer.Serialize(new { version = id, previous, candidate = true, manifest.SourceSha }));
            return final;
        }
        catch { if (Directory.Exists(stage)) Directory.Delete(stage, true); throw; }
    }
    internal static void AtomicWrite(string path, string value)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { var bytes = System.Text.Encoding.UTF8.GetBytes(value); stream.Write(bytes); stream.Flush(true); }
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public static string Active(string installation, bool rollback)
    {
        ProtectedState.RejectReparseParents(installation);
        var pointer = System.IO.Path.Combine(installation, "current.json");
        using var json = JsonDocument.Parse(File.ReadAllText(pointer));
        var version = json.RootElement.GetProperty(rollback ? "previous" : "version").GetString() ?? throw new InvalidOperationException("Rollback unavailable");
        ValidateRelative(version);
        if (version.Contains('/')) throw new InvalidOperationException("Invalid activation");
        var root = System.IO.Path.Combine(installation, "versions", version);
        Verify(root, Load(root));
        if (rollback)
        {
            using var owner = new ProtectedState(installation);
            AtomicWrite(pointer, JsonSerializer.Serialize(new { version, previous = json.RootElement.GetProperty("version").GetString(), candidate = true }));
        }
        return root;
    }
    public static void RequireProductionTrust()
    {
        // No owner-provided release identity or signed manifest policy has been enrolled.
        throw new InvalidOperationException("Production installation blocked: owner-approved signing identity and release trust policy required");
    }
}

internal sealed class VerifiedBundle(BundleManifest manifest, List<IDisposable> retained) : IDisposable
{
    public BundleManifest Manifest { get; } = manifest;
    public void Dispose()
    {
        foreach (var handle in retained.AsEnumerable().Reverse()) handle.Dispose();
        retained.Clear();
    }
}
