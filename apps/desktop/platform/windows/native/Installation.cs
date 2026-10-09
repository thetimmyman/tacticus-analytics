using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Desktop.Windows;

internal static class Installation
{
    public static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "TacticusDesktopCandidate");
    public static string Workspace => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TacticusDesktopPreview", "workspace");
    public static string PackagedWorkspaceRoot => Path.Combine(UserProfile(), "TacticusDesktopPreview");
    public static string PackagedWorkspace => Path.Combine(PackagedWorkspaceRoot, "workspace");
    private const string RegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\TacticusDesktopCandidate";
    public static void Setup(string bundle)
    {
        if (MessageBoxW(IntPtr.Zero, "Install this unsigned Windows candidate for your user? It is for qualification only. The workspace is retained when uninstalling. Production installation requires an approved signed release.", "Install Tacticus Desktop candidate", 4 | 0x30) != 6)
            throw new InvalidOperationException("Installation cancelled");
        var active = Bundle.StageCandidate(bundle, Root);
        Register(active);
    }
    internal static void Register(string active)
    {
        var executable = Path.Combine(active, "TacticusDesktop.exe");
        var comType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException("Windows shortcut service unavailable");
        dynamic shell = Activator.CreateInstance(comType)!;
        var shortcuts = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        dynamic shortcut = shell.CreateShortcut(Path.Combine(shortcuts, "Tacticus Desktop candidate.lnk"));
        try
        {
            shortcut.TargetPath = executable; shortcut.Arguments = "run-installed-candidate";
            shortcut.WorkingDirectory = active; shortcut.Description = "Local Windows candidate; synthetic demo or official read onboarding";
            shortcut.Save();
        }
        finally { Marshal.FinalReleaseComObject(shortcut); Marshal.FinalReleaseComObject(shell); }
        using var key = Registry.CurrentUser.CreateSubKey(RegistryKey);
        key.SetValue("DisplayName", "Tacticus Desktop candidate"); key.SetValue("DisplayVersion", "qualification");
        key.SetValue("InstallLocation", Root);
        key.SetValue("UninstallString", JobOwner.Quote(executable) + " uninstall-candidate");
        key.SetValue("NoModify", 1, RegistryValueKind.DWord); key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
    }
    public static void Uninstall()
    {
        if (MessageBoxW(IntPtr.Zero, "Remove the installed candidate? Your workspace and Windows vault references will be retained for reinstall.", "Uninstall Tacticus Desktop candidate", 4 | 0x40) != 6)
            return;
        // The temporary helper can finish after the installed executable exits.
        var temporary = Path.Combine(Path.GetTempPath(), "Tacticus-uninstall-" + Guid.NewGuid().ToString("N"));
        using (var protectedRoot = new ProtectedState(temporary))
            File.Copy(Environment.ProcessPath!, Path.Combine(temporary, "uninstall.exe"));
        var helper = new ProcessStartInfo(Path.Combine(temporary, "uninstall.exe")) { UseShellExecute = false };
        helper.ArgumentList.Add("finish-uninstall"); helper.ArgumentList.Add(Environment.ProcessId.ToString());
        Process.Start(helper);
    }
    public static void FinishUninstall(int parent)
    {
        try { using var process = Process.GetProcessById(parent); if (!process.WaitForExit(30000)) throw new InvalidOperationException("Uninstaller is still active"); }
        catch (ArgumentException) { }
        ProtectedState.RejectReparseParents(Root);
        using (var state = new ProtectedState(Root)) { }
        Directory.Delete(Root, true);
        var shortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Tacticus Desktop candidate.lnk");
        if (File.Exists(shortcut)) File.Delete(shortcut);
        Registry.CurrentUser.DeleteSubKeyTree(RegistryKey, false);
        // A single temporary helper remains until the next maintenance pass; no reboot/admin request is made.
    }
    private static string UserProfile()
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrWhiteSpace(profile))
            throw new InvalidOperationException("Current-user profile directory unavailable");
        return profile;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int MessageBoxW(IntPtr window, string text, string caption, uint flags);
}
