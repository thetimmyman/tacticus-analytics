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
            var package = PackageRuntime.Current();
            if (args.Length == 0)
            {
                if (package is not null)
                    return RunCandidate(package.Payload, Installation.PackagedWorkspace, Array.Empty<string>());
                throw new InvalidOperationException("Choose run-candidate, install-candidate, rollback, native-proof or official onboarding");
            }
            if (package is not null && PackageRuntime.IsUnpackagedOnlyVerb(args[0]))
                throw new InvalidOperationException("Operation unavailable in the packaged runtime");
            switch (args[0])
            {
                case "run-msix" when package is not null:
                    return RunCandidate(package.Payload, Installation.PackagedWorkspace, args.Skip(1));
                case "run-msix-qualified" when package is not null && args.Length >= 2:
                    return RunCandidate(package.Payload, QualifiedWorkspace(args[1]), args.Skip(2));
                case "package-integrity-proof" when package is not null && args.Length == 2:
                {
                    using var job = new JobOwner();
                    using var child = job.Start(Environment.ProcessPath!,
                        new[] { "proof-package-mutation", package.Payload, Path.GetFullPath(args[1]) },
                        package.Payload, removeAdministrativeAccess: true);
                    if (child.Wait() != 0) throw new InvalidOperationException("Package integrity proof failed");
                    return 0;
                }
                case "proof-package-mutation" when package is not null && args.Length == 3:
                    if (!string.Equals(Path.GetFullPath(args[1]), package.Payload, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Package proof payload is invalid");
                    PackageMutationProof.Run(package.Payload, args[2]); return 0;
                case "install": Bundle.RequireProductionTrust(); return 1;
                case "setup-candidate" when args.Length == 2: Installation.Setup(Path.GetFullPath(args[1])); return 0;
                case "uninstall-candidate": Installation.Uninstall(); return 0;
                case "finish-uninstall" when args.Length == 2 && int.TryParse(args[1], out var parent): Installation.FinishUninstall(parent); return 0;
                case "run-installed-candidate":
                {
                    var active = Bundle.Active(Installation.Root, false);
                    // The native owner must come from the activated version, so a rollback also rolls back the host.
                    var activated = Path.Combine(active, "TacticusDesktop.exe");
                    if (!string.Equals(Path.GetFullPath(Environment.ProcessPath!), Path.GetFullPath(activated), StringComparison.OrdinalIgnoreCase))
                    {
                        var host = new ProcessStartInfo(activated) { UseShellExecute = false, WorkingDirectory = active };
                        host.ArgumentList.Add("run-installed-candidate");
                        using var relaunched = Process.Start(host) ?? throw new InvalidOperationException("Activated host unavailable");
                        await relaunched.WaitForExitAsync();
                        return relaunched.ExitCode;
                    }
                    return await Main(new[] { "run-candidate", active, Installation.Workspace });
                }
                case "install-candidate" when args.Length == 3:
                    Console.WriteLine(Bundle.StageCandidate(Path.GetFullPath(args[1]), Path.GetFullPath(args[2]))); return 0;
                case "rollback" when args.Length == 2:
                    Console.WriteLine(Bundle.Active(Path.GetFullPath(args[1]), true)); return 0;
                case "run-candidate" when args.Length >= 3:
                    return RunCandidate(Path.GetFullPath(args[1]), args[2], args.Skip(3));
                case "prompt-official" when args.Length is 1 or 2:
                    Console.WriteLine(JsonSerializer.Serialize(new { handle = Vault.PromptOfficial(args.Length == 2 ? args[1] : null) })); return 0;
                case "read-official" when args.Length == 3:
                    Console.WriteLine(await Vault.ReadOfficial(args[1], args[2])); return 0;
                case "confirm-player" when args.Length == 2 && args[1].Length is > 0 and <= 100:
                    var label = new string(args[1].Where(ch => !char.IsControl(ch)).ToArray());
                    var result = MessageBoxW(IntPtr.Zero, "The official API reports Player: " + label + ". Is this the player you intend to connect? The API exposes a display name, not independent ownership proof.", "Confirm official Player", 4 | 0x40);
                    Console.WriteLine(JsonSerializer.Serialize(new { confirmed = result == 6 })); return 0;
                case "remove-official" when args.Length == 2: Vault.RemoveOfficial(args[1]); return 0;
                case "service-material" when args.Length == 2:
                    Console.WriteLine(Vault.ServiceMaterial(args[1])); return 0;
                case "choose-export" when args.Length == 1:
                    Console.WriteLine(LocalFiles.ChooseExport()); return 0;
                case "export-personal" when args.Length == 3 && long.TryParse(args[2], out var expiresAt):
                {
                    var buffer = new char[4 * 1024 * 1024 + 1]; int size = 0, count;
                    while (size < buffer.Length && (count = Console.In.Read(buffer, size, buffer.Length - size)) != 0) size += count;
                    if (size == buffer.Length) throw new InvalidOperationException("Projection size limit");
                    Console.WriteLine(LocalFiles.Export(new string(buffer, 0, size), args[1], expiresAt)); return 0;
                }
                case "choose-import" when args.Length == 1: Console.WriteLine(LocalFiles.ChooseImport()); return 0;
                case "read-import" when args.Length == 3 && long.TryParse(args[2], out var importExpiry):
                    Console.WriteLine(LocalFiles.Import(args[1], importExpiry)); return 0;
                case "native-proof" when args.Length == 2: await NativeProof.Run(args[1]); return 0;
                case "probe-node-helpers" when args.Length == 4:
                    NodeHelperProof.Run(args[1], args[2], args[3]); Console.WriteLine(File.ReadAllText(args[3])); return 0;
                case "proof-service-material" when args.Length == 2:
                    Vault.ProofServiceMaterial(); File.WriteAllText(args[1], "true"); return 0;
                case "proof-desktop" when args.Length == 2:
                    File.WriteAllText(args[1], OwnerDesktop.Current()); return 0;
                case "proof-token" when args.Length == 2:
                {
                    using var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
                    // A named object takes the token's default DACL; reopening it proves the runtime can use what it creates.
                    var name = "Local\\TacticusProof-" + Guid.NewGuid().ToString("N");
                    var reopened = false;
                    using (new Mutex(false, name))
                    {
                        try { using var opened = Mutex.OpenExisting(name); reopened = true; }
                        catch (UnauthorizedAccessException) { }
                    }
                    File.WriteAllText(args[1], JsonSerializer.Serialize(new { subject = identity.User?.Value, reopened,
                        mediumIntegrity = AdministrativeToken.CurrentIntegrity() == 0x2000,
                        administrative = new System.Security.Principal.WindowsPrincipal(identity).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator),
                        powerUser = new System.Security.Principal.WindowsPrincipal(identity).IsInRole(System.Security.Principal.WindowsBuiltInRole.PowerUser) }));
                    return 0;
                }
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
                    using var child = job.Start(Environment.ProcessPath!, new[] { "proof-descendant", args[1] }, AppContext.BaseDirectory, removeAdministrativeAccess: true);
                    child.Wait(); return 0;
                }
                default: throw new InvalidOperationException("Unsupported native operation");
            }
        }
        catch (Exception error)
        {
            // Failure text is deliberately bounded: upstream bodies, command lines and credentials are never logged.
            Console.Error.WriteLine(error is InvalidOperationException ? error.Message :
                error is System.ComponentModel.Win32Exception nativeError ? $"Native OS operation failed; status {nativeError.NativeErrorCode}." :
                "Native operation failed. Check secure input/store availability, package integrity, workspace ownership and supported platform.");
            return error is SecureStoreUnavailable ? 2 : error is OfficialAccessUnavailable ? 3 : error is LocalSessionExpired ? 4 : 1;
        }
    }
    private static string QualifiedWorkspace(string value)
    {
        if (!Path.IsPathFullyQualified(value))
            throw new InvalidOperationException("Qualification workspace must be absolute");
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Installation.PackagedWorkspaceRoot));
        var workspace = Path.TrimEndingDirectorySeparator(Path.GetFullPath(value));
        var prefix = root + Path.DirectorySeparatorChar;
        if (!workspace.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Qualification workspace is outside the qualification root");
        var relative = workspace[prefix.Length..];
        var separator = relative.IndexOfAny(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar });
        const string qualificationPrefix = "qualification-";
        if (separator <= qualificationPrefix.Length || separator == relative.Length - 1 ||
            !relative[..separator].StartsWith(qualificationPrefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Qualification workspace is outside a qualification run");
        return workspace;
    }
    private static int RunCandidate(string root, string workspace, IEnumerable<string> forwarded)
    {
        var arguments = forwarded.ToArray();
        var measurementIndex = Array.IndexOf(arguments, "--measurement");
        var measurementPath = measurementIndex >= 0 && measurementIndex + 1 < arguments.Length
            ? arguments[measurementIndex + 1]
            : null;
        WriteMeasurement(measurementPath, "native-admitted", null, null, null, null);
        var manifest = Bundle.Load(root);
        Bundle.Verify(root, manifest);
        using var state = new ProtectedState(workspace);
        using var job = new JobOwner();
        var script = Path.Combine(root, "apps", "desktop", "platform", "windows", "launch.mjs");
        var postgresHome = RuntimePaths.AsciiDirectory(Path.Combine(root, "postgres"));
        var command = new[] { script, "--state", state.Root, "--postgres-home", postgresHome }.Concat(arguments);
        var timer = Stopwatch.StartNew();
        WriteMeasurement(measurementPath, "native-prelaunch", manifest.SourceSha, timer.ElapsedMilliseconds, null, null);
        // The package payload is immutable. Start the coordinator in its
        // protected writable state so native tools that inspect or inherit the
        // current directory never depend on a writable installation tree.
        using var process = job.Start(Path.Combine(root, "bin", "node.exe"), command, state.Root, removeAdministrativeAccess: true);
        var code = process.Wait();
        long? peak = null;
        try
        {
            var measured = job.PeakCommittedBytes();
            if (measured > 0) peak = measured;
        }
        catch (System.ComponentModel.Win32Exception) { }
        WriteMeasurement(measurementPath, "child-exited", manifest.SourceSha, timer.ElapsedMilliseconds, peak, code);
        return code;
    }
    private static void WriteMeasurement(string? path, string stage, string? sourceSha, long? elapsedMs, long? peakJobCommittedBytes, int? exitCode)
    {
        if (path is null) return;
        File.WriteAllText(path, JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            platform = "win-x64",
            stage,
            sourceSha,
            elapsedMs,
            peakJobCommittedBytes,
            exitCode,
            metric = "Windows Job Object peak committed memory; not RSS"
        }));
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
            var alias = RuntimePaths.AsciiDirectory(testRoot);
            File.WriteAllText(Path.Combine(testRoot, "alias-proof.txt"), "synthetic alias target");
            if (alias.Any(ch => ch > 127) || File.ReadAllText(Path.Combine(alias, "alias-proof.txt")) != "synthetic alias target")
                throw new InvalidOperationException("Native ASCII alias target verification failed");
            assertions.Add("native-ascii-alias-preserves-unicode-directory-target");
            var tokenRecord = Path.Combine(testRoot, "token.json");
            using (var job = new JobOwner())
            using (var child = job.Start(Environment.ProcessPath!, new[] { "proof-token", tokenRecord }, testRoot, removeAdministrativeAccess: true))
            {
                if (child.Wait() != 0) throw new InvalidOperationException("Nonadministrative child token proof failed");
                using var token = JsonDocument.Parse(File.ReadAllText(tokenRecord));
                using var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
                if (token.RootElement.GetProperty("administrative").GetBoolean() || token.RootElement.GetProperty("powerUser").GetBoolean() ||
                    !token.RootElement.GetProperty("reopened").GetBoolean() ||
                    !token.RootElement.GetProperty("mediumIntegrity").GetBoolean() ||
                    token.RootElement.GetProperty("subject").GetString() != identity.User?.Value)
                    throw new InvalidOperationException("Child did not retain the current user without administrative access");
            }
            File.Delete(tokenRecord);
            assertions.Add("same-user-nonadministrative-medium-integrity-child-token");
            var desktopRecord = Path.Combine(testRoot, "owner-desktop.txt");
            using (var job = new JobOwner())
            using (var child = job.Start(Environment.ProcessPath!, new[] { "proof-desktop", desktopRecord }, testRoot, removeAdministrativeAccess: true))
            {
                var status = child.Wait();
                if (status != 0 || !File.Exists(desktopRecord) || File.ReadAllText(desktopRecord) != OwnerDesktop.Current())
                    throw new InvalidOperationException($"Nonadministrative owner desktop proof failed; exit {status}");
            }
            File.Delete(desktopRecord);
            assertions.Add("same-user-nonadministrative-owner-desktop-without-policy-change");
            var vaultRecord = Path.Combine(testRoot, "service-material-proof.json");
            using (var job = new JobOwner())
            using (var child = job.Start(Environment.ProcessPath!, new[] { "proof-service-material", vaultRecord }, testRoot, removeAdministrativeAccess: true))
            {
                var status = child.Wait();
                if (status != 0 || !File.Exists(vaultRecord) || File.ReadAllText(vaultRecord) != "true")
                    throw new InvalidOperationException($"Nonadministrative service material proof failed; exit {status}");
            }
            File.Delete(vaultRecord);
            assertions.Add("same-user-nonadministrative-vault-service-material-and-reopen");
            var record = Path.Combine(testRoot, "tree.json");
            using (var job = new JobOwner())
            {
                using var child = job.Start(Environment.ProcessPath!, new[] { "proof-descendant", record }, testRoot, removeAdministrativeAccess: true);
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
                var acl = System.IO.FileSystemAclExtensions.GetAccessControl(new DirectoryInfo(state.Root));
                var sid = System.Security.Principal.WindowsIdentity.GetCurrent().User!;
                if (!acl.AreAccessRulesProtected || acl.GetAccessRules(true, true, typeof(System.Security.Principal.SecurityIdentifier))
                    .Cast<System.Security.AccessControl.FileSystemAccessRule>().Any(rule => rule.IdentityReference.Value != sid.Value && rule.IdentityReference.Value != "S-1-5-18"))
                    throw new InvalidOperationException("Unexpected workspace ACL");
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
                var escaped = string.Concat(Encoding.UTF8.GetString(canary).Select(ch => "\\u" + ((int)ch).ToString("x4")));
                using var jsonEcho = JsonDocument.Parse("{\"player\":{\"name\":\"" + escaped + "\"}}");
                var escapedRejected = false;
                try { Vault.RejectJsonEcho(jsonEcho.RootElement, Encoding.UTF8.GetString(canary), canary); } catch (InvalidOperationException) { escapedRejected = true; }
                if (!escapedRejected) throw new InvalidOperationException("JSON escaped echo accepted");
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
            foreach (var value in new[] { "{\"personal\":{\"api_key\":\"synthetic\"}}", "{\"vaultReferences\":{}}", "{\"unexpected\":true}" })
            {
                var rejected = false;
                try { using var parsed = LocalFiles.Validate(value); } catch (InvalidOperationException) { rejected = true; }
                if (!rejected) throw new InvalidOperationException("Unsafe projection accepted");
            }
            assertions.Add("credential-fields-and-unknown-projection-fields-rejected");
            var projection = Path.Combine(testRoot, "projection ü.json");
            try { LocalFiles.Export("{}", projection, 0); throw new InvalidOperationException("Expired export accepted"); }
            catch (LocalSessionExpired) { if (File.Exists(projection)) throw new InvalidOperationException("Expired export wrote destination"); }
            LocalFiles.Export("{\"status\":\"cached\"}", projection, DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds());
            if (File.ReadAllText(projection).IndexOf("cached", StringComparison.Ordinal) < 0 || !new FileInfo(projection).GetAccessControl().AreAccessRulesProtected)
                throw new InvalidOperationException("Protected export failed");
            assertions.Add("expired-export-refused-and-atomic-protected-projection");
            try { LocalFiles.Import(Path.Combine(testRoot, "unopened.json"), 0); throw new InvalidOperationException("Expired import opened source"); }
            catch (LocalSessionExpired) { }
            if (!LocalFiles.Import(projection, DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds()).Contains("cached"))
                throw new InvalidOperationException("Native same-handle import failed");
            File.WriteAllText(projection, "{\"status\":\"cached\"}", new UTF8Encoding(true));
            if (!LocalFiles.Import(projection, DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds()).Contains("cached"))
                throw new InvalidOperationException("UTF8 BOM native import failed");
            File.WriteAllText(projection, "{\"personal\":{\"api-key\":\"synthetic\"}}");
            var unsafeImport = false;
            try { LocalFiles.Import(projection, DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds()); }
            catch (InvalidOperationException) { unsafeImport = true; }
            if (!unsafeImport) throw new InvalidOperationException("Credential-bearing native import accepted");
            File.WriteAllText(projection, new string('x', 4 * 1024 * 1024 + 1));
            var oversizedImport = false;
            try { LocalFiles.Import(projection, DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds()); }
            catch (InvalidOperationException) { oversizedImport = true; }
            if (!oversizedImport) throw new InvalidOperationException("Oversized native import accepted");
            assertions.Add("expired-import-refused-and-bounded-same-handle-credential-free-read");
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
        catch (Exception error) when (error is not InvalidOperationException)
        {
            var status = error is System.ComponentModel.Win32Exception nativeError ? $"Win32 status {nativeError.NativeErrorCode}" :
                $"{error.GetType().Name}, HRESULT 0x{error.HResult:x8}";
            throw new InvalidOperationException($"Native proof phase {assertions.Count} failed ({status})");
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
