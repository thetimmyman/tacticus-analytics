using System.Diagnostics;
using System.Text.Json;
using System.Text;

namespace Desktop.Windows;

internal static class Program
{
    [STAThread]
    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length == 0) throw new InvalidOperationException("Choose run-candidate, install-candidate, rollback, native-proof or official onboarding");
            switch (args[0])
            {
                case "install": Bundle.RequireProductionTrust(); return 1;
                case "setup-candidate" when args.Length == 2: Installation.Setup(Path.GetFullPath(args[1])); return 0;
                case "uninstall-candidate": Installation.Uninstall(); return 0;
                case "finish-uninstall" when args.Length == 2 && int.TryParse(args[1], out var parent): Installation.FinishUninstall(parent); return 0;
                case "run-installed-candidate":
                    return await Main(new[] { "run-candidate", Bundle.Active(Installation.Root, false), Installation.Workspace });
                case "install-candidate" when args.Length == 3:
                    Console.WriteLine(Bundle.StageCandidate(Path.GetFullPath(args[1]), Path.GetFullPath(args[2]))); return 0;
                case "rollback" when args.Length == 2:
                    Console.WriteLine(Bundle.Active(Path.GetFullPath(args[1]), true)); return 0;
                case "run-candidate" when args.Length >= 3:
                {
                    var root = Path.GetFullPath(args[1]);
                    Bundle.Verify(root, Bundle.Load(root));
                    using var state = new ProtectedState(args[2]);
                    using var job = new JobOwner();
                    var script = Path.Combine(root, "apps", "desktop", "platform", "windows", "launch.mjs");
                    var command = new[] { script, "--state", state.Root }.Concat(args.Skip(3));
                    using var process = job.Start(Path.Combine(root, "bin", "node.exe"), command, root);
                    return process.Wait();
                }
                case "prompt-official" when args.Length == 1:
                    Console.WriteLine(JsonSerializer.Serialize(new { handle = Vault.PromptOfficial() })); return 0;
                case "read-official" when args.Length == 3:
                    Console.WriteLine(await Vault.ReadOfficial(args[1], args[2])); return 0;
                case "confirm-player" when args.Length == 2 && args[1].Length is > 0 and <= 100:
                    var label = new string(args[1].Where(ch => !char.IsControl(ch)).ToArray());
                    var result = MessageBoxW(IntPtr.Zero, "The official API reports Player: " + label + ". Is this the player you intend to connect? The API exposes a display name, not independent ownership proof.", "Confirm official Player", 4 | 0x40);
                    Console.WriteLine(JsonSerializer.Serialize(new { confirmed = result == 6 })); return 0;
                case "remove-official" when args.Length == 2: Vault.RemoveOfficial(args[1]); return 0;
                case "service-material" when args.Length == 2:
                    Console.WriteLine(Vault.ServiceMaterial(args[1])); return 0;
                case "export-personal" when args.Length == 1:
                {
                    var buffer = new char[4 * 1024 * 1024 + 1]; int size = 0, count;
                    while (size < buffer.Length && (count = Console.In.Read(buffer, size, buffer.Length - size)) != 0) size += count;
                    if (size == buffer.Length) throw new InvalidOperationException("Projection size limit");
                    Console.WriteLine(LocalFiles.Export(new string(buffer, 0, size))); return 0;
                }
                case "import-personal" when args.Length == 1: Console.WriteLine(LocalFiles.Import()); return 0;
                case "native-proof" when args.Length == 2: await NativeProof.Run(args[1]); return 0;
                case "proof-descendant" when args.Length == 2:
                {
                    var child = Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "proof-leaf") { UseShellExecute = false })!;
                    File.WriteAllText(args[1], JsonSerializer.Serialize(new { owner = Environment.ProcessId, child = child.Id }));
                    Thread.Sleep(Timeout.Infinite); return 0;
                }
                case "proof-leaf": Thread.Sleep(Timeout.Infinite); return 0;
                case "proof-owner" when args.Length == 2:
                {
                    using var job = new JobOwner();
                    using var child = job.Start(Environment.ProcessPath!, new[] { "proof-descendant", args[1] }, AppContext.BaseDirectory);
                    child.Wait(); return 0;
                }
                default: throw new InvalidOperationException("Unsupported native operation");
            }
        }
        catch (Exception)
        {
            // Failure text is deliberately bounded: upstream bodies, command lines and credentials are never logged.
            Console.Error.WriteLine("Native operation failed. Check secure input/store availability, package integrity, workspace ownership and supported platform.");
            return 1;
        }
    }
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr window, string text, string caption, uint flags);
}

internal static class NativeProof
{
    public static async Task Run(string evidencePath)
    {
        var timer = Stopwatch.StartNew();
        var testRoot = Path.Combine(Path.GetTempPath(), "Tacticus native proof ü " + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(testRoot);
        var assertions = new List<string>();
        try
        {
            var record = Path.Combine(testRoot, "tree.json");
            using (var job = new JobOwner())
            {
                using var child = job.Start(Environment.ProcessPath!, new[] { "proof-descendant", record }, testRoot);
                await WaitFile(record);
            }
            await RequireDead(record); assertions.Add("job-close-kills-descendants");
            File.Delete(record);
            using (var owner = Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "proof-owner " + JobOwner.Quote(record)) { UseShellExecute = false })!)
            {
                await WaitFile(record); owner.Kill(); await owner.WaitForExitAsync();
            }
            await RequireDead(record); assertions.Add("force-owner-death-kills-descendants");
            using (var state = new ProtectedState(Path.Combine(testRoot, "workspace ü")))
            {
                var rejected = false;
                try { using var duplicate = new ProtectedState(state.Root); } catch (InvalidOperationException) { rejected = true; }
                if (!rejected) throw new InvalidOperationException("Concurrent workspace accepted");
            }
            assertions.Add("protected-unicode-state-and-concurrent-launch");
            var target = "TacticusDesktop/Proof/" + Guid.NewGuid().ToString("N");
            var canary = Encoding.UTF8.GetBytes("synthetic-native-vault-canary");
            try
            {
                Vault.Write(target, canary);
                var returned = Vault.Read(target);
                if (!returned.SequenceEqual(canary)) throw new InvalidOperationException("Vault roundtrip failed");
                System.Security.Cryptography.CryptographicOperations.ZeroMemory(returned);
                foreach (var echo in new[] { Encoding.UTF8.GetString(canary), Convert.ToBase64String(canary), Convert.ToHexString(canary) })
                {
                    var rejected = false;
                    try { Vault.RejectEcho(echo, Encoding.UTF8.GetString(canary), canary); } catch (InvalidOperationException) { rejected = true; }
                    if (!rejected) throw new InvalidOperationException("Echo accepted");
                }
            }
            finally { Vault.Remove(target); System.Security.Cryptography.CryptographicOperations.ZeroMemory(canary); }
            try { Vault.Read(target); throw new InvalidOperationException("Deleted entry readable"); }
            catch (InvalidOperationException) { if (System.Runtime.InteropServices.Marshal.GetLastWin32Error() != 1168) throw; }
            assertions.Add("native-vault-roundtrip-revocation-and-secret-echo-rejection");
            foreach (var path in new[] { "../escape", "C:/escape", "a:stream", "a\\b", "CON", "x.", "a//b", "/root" })
            {
                var rejected = false;
                try { Bundle.ValidateRelative(path); } catch (InvalidOperationException) { rejected = true; }
                if (!rejected) throw new InvalidOperationException("Unsafe path accepted");
            }
            assertions.Add("windows-traversal-device-name-and-stream-rejection");
            var candidate = Path.Combine(testRoot, "source"); Directory.CreateDirectory(candidate);
            File.WriteAllText(Path.Combine(candidate, "item.txt"), "synthetic retained content");
            var digest = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(Path.Combine(candidate, "item.txt")))).ToLowerInvariant();
            File.WriteAllText(Path.Combine(candidate, "bundle-manifest.json"), JsonSerializer.Serialize(new { schemaVersion = 1, platform = "win-x64", sourceSha = new string('a', 40), files = new[] { new { path = "item.txt", size = new FileInfo(Path.Combine(candidate, "item.txt")).Length, sha256 = digest } } }));
            var install = Path.Combine(testRoot, "install ü");
            var first = Bundle.StageCandidate(candidate, install); var second = Bundle.StageCandidate(candidate, install);
            if (first == second || Bundle.Active(install, true) != first) throw new InvalidOperationException("Rollback failed");
            File.WriteAllText(Path.Combine(candidate, "item.txt"), "substitution");
            var bad = false; try { Bundle.StageCandidate(candidate, install); } catch (InvalidOperationException) { bad = true; }
            if (!bad || Bundle.Active(install, false) != first) throw new InvalidOperationException("Failed update changed activation");
            assertions.Add("staged-update-substitution-rejection-and-rollback");
            File.WriteAllText(evidencePath, JsonSerializer.Serialize(new { schemaVersion = 1, platform = "win-x64", os = Environment.OSVersion.VersionString,
                sourceSha = Environment.GetEnvironmentVariable("TACTICUS_BUILD_SHA"),
                artifactSha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(Environment.ProcessPath!))).ToLowerInvariant(),
                artifactBytes = new FileInfo(Environment.ProcessPath!).Length,
                runtime = Environment.Version.ToString(), native = true, candidateOnly = true, consumerStandardUser = false,
                elapsedMs = timer.ElapsedMilliseconds, assertions }, new JsonSerializerOptions { WriteIndented = true }));
        }
        finally { Directory.Delete(testRoot, true); }
    }
    private static async Task WaitFile(string path)
    {
        for (var i = 0; i < 100; i++) { if (File.Exists(path)) return; await Task.Delay(100); }
        throw new InvalidOperationException("Native descendant did not start");
    }
    private static async Task RequireDead(string path)
    {
        using var json = JsonDocument.Parse(File.ReadAllText(path));
        foreach (var key in new[] { "owner", "child" })
        {
            var pid = json.RootElement.GetProperty(key).GetInt32();
            for (var i = 0; i < 100; i++)
            {
                try { using var process = Process.GetProcessById(pid); if (process.HasExited) break; }
                catch (ArgumentException) { break; }
                if (i == 99) throw new InvalidOperationException("Orphaned descendant");
                await Task.Delay(100);
            }
        }
    }
}
