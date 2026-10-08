using System.ComponentModel;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Desktop.Windows;

internal sealed class SecureStoreUnavailable(string message) : InvalidOperationException(message);
internal sealed class OfficialAccessUnavailable(string message) : InvalidOperationException(message);

internal static class Vault
{
    private const string Prefix = "TacticusDesktop/OfficialRead/v1/";
    public static string Handle(string handle)
    {
        if (!Guid.TryParseExact(handle, "N", out _)) throw new InvalidOperationException("Invalid credential reference");
        return Prefix + handle;
    }
    public static string PromptOfficial(string? pendingHandle = null)
    {
        var handle = pendingHandle ?? Guid.NewGuid().ToString("N");
        var target = Handle(handle);
        var info = new UiInfo { Size = Marshal.SizeOf<UiInfo>(), Caption = "Connect official Tacticus API",
            Message = "Enter an official API key in the password field. Player is required; Guild and Guild Raid are optional. This consents to official reads on this device only. Cloud contribution needs separate consent. Never enter a game-client secret." };
        var user = new StringBuilder("Official API key", 514);
        var password = Marshal.AllocHGlobal(1024 * 2);
        var zeros = new byte[1024 * 2];
        Marshal.Copy(zeros, 0, password, zeros.Length);
        try
        {
            var save = false;
            var result = CredUIPromptForCredentialsW(ref info, target, IntPtr.Zero, 0, user, 514,
                password, 1024, ref save, 0x40000 | 0x80 | 0x2 | 0x100000);
            if (result != 0) throw new SecureStoreUnavailable("Native secure input cancelled or unavailable");
            var value = Marshal.PtrToStringUni(password) ?? "";
            if (value.Length is < 8 or > 512 || value.Any(char.IsControl)) throw new InvalidOperationException("Official credential unavailable");
            var bytes = Encoding.UTF8.GetBytes(value);
            try { Write(target, bytes); } finally { CryptographicOperations.ZeroMemory(bytes); }
            return handle;
        }
        finally { Marshal.Copy(zeros, 0, password, zeros.Length); Marshal.FreeHGlobal(password); }
    }
    internal static void Write(string target, byte[] bytes)
    {
        if (bytes.Length > 2560) throw new InvalidOperationException("Credential size limit");
        var pointer = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            var credential = new Credential { Type = 1, Target = target, BlobSize = (uint)bytes.Length,
                Blob = pointer, Persist = 2, User = "device-local" };
            if (!CredWriteW(ref credential, 0)) throw new SecureStoreUnavailable("Windows vault unavailable; no plaintext fallback");
        }
        finally { Marshal.Copy(new byte[bytes.Length], 0, pointer, bytes.Length); Marshal.FreeHGlobal(pointer); }
    }
    internal static byte[] Read(string target)
    {
        if (!CredReadW(target, 1, 0, out var pointer)) throw new SecureStoreUnavailable("Windows vault locked, disconnected or unavailable");
        try
        {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            if (credential.BlobSize is 0 or > 2560) throw new InvalidOperationException("Invalid vault entry");
            var bytes = new byte[credential.BlobSize];
            Marshal.Copy(credential.Blob, bytes, 0, bytes.Length); return bytes;
        }
        finally { CredFree(pointer); }
    }
    public static void RemoveOfficial(string handle) => Remove(Handle(handle));
    internal static void Remove(string target)
    {
        if (!CredDeleteW(target, 1, 0) && Marshal.GetLastWin32Error() != 1168)
            throw new SecureStoreUnavailable("Windows vault removal unavailable");
    }
    public static async Task<string> ReadOfficial(string handle, string scope)
    {
        var path = scope switch { "Player" => "player", "Guild" => "guild", "Guild Raid" => "guildRaid",
            _ => throw new InvalidOperationException("Unsupported official capability") };
        var bytes = Read(Handle(handle));
        try
        {
            var secret = Encoding.UTF8.GetString(bytes);
            using var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false });
            client.Timeout = TimeSpan.FromSeconds(15);
            using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.tacticusgame.com/api/v1/" + path);
            request.Headers.Add("X-API-KEY", secret); request.Headers.Add("Accept", "application/json");
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            if (!response.IsSuccessStatusCode) throw new OfficialAccessUnavailable("Official access expired, revoked or unavailable");
            using var stream = await response.Content.ReadAsStreamAsync();
            using var output = new MemoryStream();
            var buffer = new byte[8192];
            int count;
            while ((count = await stream.ReadAsync(buffer)) != 0)
            {
                if (output.Length + count > 4 * 1024 * 1024) throw new OfficialAccessUnavailable("Official response limit");
                output.Write(buffer, 0, count);
            }
            var body = Encoding.UTF8.GetString(output.ToArray());
            RejectEcho(body, secret, bytes);
            using var json = JsonDocument.Parse(body);
            if (json.RootElement.ValueKind != JsonValueKind.Object) throw new OfficialAccessUnavailable("Official response unavailable");
            RejectJsonEcho(json.RootElement, secret, bytes);
            return body;
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    internal static void RejectEcho(string body, string secret, byte[] bytes)
    {
        foreach (var value in new[] { secret, Convert.ToBase64String(bytes), Convert.ToHexString(bytes),
                     Convert.ToHexString(bytes).ToLowerInvariant(), Uri.EscapeDataString(secret),
                     Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') })
            if (body.Contains(value, StringComparison.Ordinal)) throw new OfficialAccessUnavailable("Unsafe official response");
    }
    internal static void RejectJsonEcho(JsonElement element, string secret, byte[] bytes)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.String: RejectEcho(element.GetString() ?? "", secret, bytes); break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray()) RejectJsonEcho(item, secret, bytes); break;
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject()) { RejectEcho(property.Name, secret, bytes); RejectJsonEcho(property.Value, secret, bytes); } break;
        }
    }
    private static string ServiceTarget(string state)
    {
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(state).ToUpperInvariant())));
        return "TacticusDesktop/LocalServices/v1/" + digest;
    }
    internal static void ProofServiceMaterial()
    {
        var state = Path.Combine(Path.GetTempPath(), "Tacticus synthetic service material ü " + Guid.NewGuid().ToString("N"));
        try
        {
            var first = ServiceMaterial(state);
            using var parsed = JsonDocument.Parse(first);
            if (new[] { "owner", "auth", "rest", "jwt" }.Any(key =>
                parsed.RootElement.GetProperty(key).GetString() is not { Length: 64 } value || value.Any(ch => !char.IsAsciiHexDigit(ch))))
                throw new InvalidOperationException("Native service material proof failed");
            if (first != ServiceMaterial(state)) throw new InvalidOperationException("Native service material changed on reopen");
        }
        finally { Remove(ServiceTarget(state)); }
    }
    public static string ServiceMaterial(string state)
    {
        var target = ServiceTarget(state);
        byte[] bytes;
        try { bytes = Read(target); }
        catch (InvalidOperationException)
        {
            // A failed vault read may be a locked store, not a missing entry. Only ERROR_NOT_FOUND can initialize.
            if (Marshal.GetLastWin32Error() != 1168) throw;
            var keys = new[] { "owner", "auth", "rest", "jwt" }.ToDictionary(key => key,
                _ => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant());
            bytes = JsonSerializer.SerializeToUtf8Bytes(keys);
            Write(target, bytes);
        }
        try { return Encoding.UTF8.GetString(bytes); } finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct UiInfo
    { public int Size; public IntPtr Parent; public string? Message, Caption; public IntPtr Banner; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Credential
    {
        public uint Flags, Type; public string? Target, Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint BlobSize; public IntPtr Blob; public uint Persist, AttributeCount; public IntPtr Attributes;
        public string? Alias, User;
    }
    [DllImport("credui.dll", CharSet = CharSet.Unicode)] private static extern uint CredUIPromptForCredentialsW(
        ref UiInfo info, string target, IntPtr context, uint error, StringBuilder user, uint userLength,
        IntPtr password, uint passwordLength, ref bool save, uint flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredWriteW(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredDeleteW(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr credential);
}
