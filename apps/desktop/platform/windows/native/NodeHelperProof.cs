using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Diagnostics;

namespace Desktop.Windows;

internal static class NodeHelperProof
{
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed record Helper(string Operation, long? ExitCode, string? ErrorCode, bool Completed, bool? OwnerDesktopMatches);
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed record Case(string Mode, Helper[] Helpers);
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed record Result(string NodeVersion, Case[] Cases);
    public static void Run(string node, string script, string evidence)
    {
        if (Digest(Path.GetFullPath(node)) != "0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4")
            throw new InvalidOperationException("Node helper diagnostic binary differs from the pinned bundled runtime");
        var timer = Stopwatch.StartNew();
        var root = Path.Combine(Path.GetTempPath(), "Tacticus helper diagnostic ü " + Guid.NewGuid().ToString("N"));
        try
        {
            using var state = new ProtectedState(root);
            File.WriteAllText(Path.Combine(root, "owner-desktop.txt"), OwnerDesktop.Current());
            using var job = new JobOwner();
            using var child = job.Start(Path.GetFullPath(node), new[] { Path.GetFullPath(script), Environment.ProcessPath!, root }, root, removeAdministrativeAccess: true);
            var status = child.Wait();
            if (status != 0) throw new InvalidOperationException($"Node helper diagnostic owner failed; exit {status}");
            using var input = new FileStream(Path.Combine(root, "helper-result.json"), FileMode.Open, FileAccess.Read, FileShare.Read);
            if (input.Length > 16384) throw new InvalidOperationException("Node helper diagnostic limit");
            var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            var result = JsonSerializer.Deserialize<Result>(input, options) ?? throw new InvalidOperationException("Node helper diagnostic unavailable");
            var modes = new[] { "hidden-pipes", "attached-pipes", "hidden-inherited-input" };
            var operations = new[] { "proof-service-material", "proof-desktop" };
            if (result.NodeVersion != "v22.23.2" || result.Cases.Length != modes.Length)
                throw new InvalidOperationException("Node helper diagnostic runtime mismatch");
            for (var i = 0; i < modes.Length; i++)
            {
                if (result.Cases[i].Mode != modes[i] || result.Cases[i].Helpers.Length != operations.Length)
                    throw new InvalidOperationException("Node helper diagnostic cases unavailable");
                for (var j = 0; j < operations.Length; j++)
                {
                    var item = result.Cases[i].Helpers[j];
                    if (item.Operation != operations[j] || item.ExitCode is < int.MinValue or > uint.MaxValue ||
                        item.ErrorCode is not (null or "EACCES" or "EINVAL" or "ENOENT" or "OWNED_SPAWN_REFUSED" or "OWNED_HELPER_TIMEOUT"))
                        throw new InvalidOperationException("Node helper diagnostic status unavailable");
                }
            }
            File.WriteAllText(evidence, JsonSerializer.Serialize(new { schemaVersion = 1, platform = "win-x64",
                sourceSha = Environment.GetEnvironmentVariable("TACTICUS_BUILD_SHA"), diagnosticOnly = true, installedApplicationQualified = false,
                consumerStandardUser = false, nativeHostSha256 = Digest(Environment.ProcessPath!), nodeSha256 = Digest(Path.GetFullPath(node)),
                elapsedMs = timer.ElapsedMilliseconds, result.NodeVersion, result.Cases }, options));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
    private static string Digest(string path)
    { using var stream = File.OpenRead(path); return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant(); }
}
