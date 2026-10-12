using System.ComponentModel;
using System.Collections;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Desktop.Windows;

// The job handle is private to this owner. No descendant can keep it alive.
internal sealed class JobOwner : IDisposable
{
    private readonly SafeFileHandle job;
    public JobOwner()
    {
        job = CreateJobObjectW(IntPtr.Zero, null);
        if (job.IsInvalid) throw new Win32Exception();
        var limits = new ExtendedLimit { Basic = new BasicLimit { Flags = 0x2000 } };
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimit>()))
        { job.Dispose(); throw new Win32Exception(); }
    }
    public OwnedProcess Start(string executable, IEnumerable<string> arguments, string workingDirectory,
        bool removeAdministrativeAccess = false, bool retainDesktopAppRuntime = false)
    {
        var startup = new Startup { Size = (uint)Marshal.SizeOf<Startup>() };
        var command = new StringBuilder(Quote(executable) + " " + string.Join(" ", arguments.Select(Quote)));
        using var reduced = removeAdministrativeAccess ? AdministrativeToken.ReduceCurrent() : null;
        if (reduced is not null) startup.Desktop = OwnerDesktop.Current();
        ProcessInfo process;
        using var environment = ChildEnvironment.Create();
        var flags = CreateSuspended | CreateUnicodeEnvironment;
        bool started;
        var startError = 0;
        if (retainDesktopAppRuntime)
        {
            // Desktop Bridge processes otherwise launch children outside the desktop app runtime.
            // Retain it for the complete coordinator tree, including PostgreSQL's own children.
            using var attributes = DesktopAppPolicy.Create();
            var extended = new StartupEx
            {
                StartupInfo = startup,
                AttributeList = attributes.Pointer
            };
            extended.StartupInfo.Size = (uint)Marshal.SizeOf<StartupEx>();
            flags |= ExtendedStartupInfoPresent;
            started = reduced is null
                ? CreateProcessExtendedW(executable, command, IntPtr.Zero, IntPtr.Zero, false,
                    flags, environment.Pointer, workingDirectory, ref extended, out process)
                : CreateProcessAsUserExtendedW(reduced, executable, command, IntPtr.Zero, IntPtr.Zero, false,
                    flags, environment.Pointer, workingDirectory, ref extended, out process);
            if (!started) startError = Marshal.GetLastWin32Error();
        }
        else
        {
            started = reduced is null
                ? CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false,
                    flags, environment.Pointer, workingDirectory, ref startup, out process)
                : CreateProcessAsUserW(reduced, executable, command, IntPtr.Zero, IntPtr.Zero, false,
                    flags, environment.Pointer, workingDirectory, ref startup, out process);
            if (!started) startError = Marshal.GetLastWin32Error();
        }
        if (!started)
            throw new Win32Exception(startError);
        using var thread = new SafeFileHandle(process.Thread, true);
        var handle = new SafeFileHandle(process.Process, true);
        try
        {
            // CREATE_SUSPENDED prevents a child escaping before assignment.
            if (!AssignProcessToJobObject(job, handle)) throw new Win32Exception();
            if (ResumeThread(thread) == uint.MaxValue) throw new Win32Exception();
            return new OwnedProcess(handle, checked((int)process.ProcessId));
        }
        catch { TerminateProcess(handle, 1); handle.Dispose(); throw; }
    }
    internal static string Quote(string value)
    {
        if (value.Contains('\0')) throw new ArgumentException("Invalid argument");
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var ch in value)
        {
            if (ch == '\\') { slashes++; continue; }
            result.Append('\\', ch == '"' ? slashes * 2 + 1 : slashes);
            result.Append(ch); slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    public void Dispose()
    {
        try
        {
            if (!TerminateJobObject(job, 1)) throw new Win32Exception();
            for (var attempt = 0; attempt < 300; attempt++)
            {
                var accounting = new BasicAccounting();
                if (!QueryInformationJobObject(job, 1, ref accounting, (uint)Marshal.SizeOf<BasicAccounting>(), IntPtr.Zero))
                    throw new Win32Exception();
                if (accounting.ActiveProcesses == 0) return;
                Thread.Sleep(100);
            }
            throw new InvalidOperationException("Owned process tree did not stop");
        }
        finally { job.Dispose(); }
    }
    public long PeakCommittedBytes()
    {
        var limits = new ExtendedLimit();
        if (!QueryInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimit>(), IntPtr.Zero)) throw new Win32Exception();
        return checked((long)limits.PeakJobMemory.ToUInt64());
    }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimit
    {
        public long ProcessTime, JobTime; public uint Flags;
        public UIntPtr MinWorking, MaxWorking; public uint ActiveLimit;
        public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters
    { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimit
    { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicAccounting
    {
        public long TotalUserTime, TotalKernelTime, ThisPeriodUserTime, ThisPeriodKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup
    {
        public uint Size; public string? Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XCount, YCount, Fill, Flags;
        public ushort Show, ReservedSize; public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupEx
    { public Startup StartupInfo; public IntPtr AttributeList; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo
    { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(SafeFileHandle job, int infoClass, ref ExtendedLimit limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(SafeFileHandle job, int infoClass, ref ExtendedLimit limits, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(SafeFileHandle job, int infoClass, ref BasicAccounting accounting, uint size, IntPtr returned);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo info);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", ExactSpelling = true, CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessExtendedW(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo info);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessAsUserW(SafeAccessTokenHandle token, string application, StringBuilder command,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment,
        string cwd, ref Startup startup, out ProcessInfo info);
    [DllImport("advapi32.dll", EntryPoint = "CreateProcessAsUserW", ExactSpelling = true, CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessAsUserExtendedW(SafeAccessTokenHandle token, string application, StringBuilder command,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment,
        string cwd, ref StartupEx startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(SafeFileHandle job, SafeFileHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(SafeFileHandle thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(SafeFileHandle process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(SafeFileHandle job, uint code);

    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint ExtendedStartupInfoPresent = 0x00080000;

    private sealed class DesktopAppPolicy : IDisposable
    {
        // ProcThreadAttributeValue(18, false, true, false).
        private static readonly IntPtr Attribute = (IntPtr)0x00020012;
        private const uint BreakawayDisableProcessTree = 0x02;
        private const uint BreakawayOverride = 0x04;
        public IntPtr Pointer { get; }
        private readonly IntPtr policy;

        private DesktopAppPolicy(IntPtr pointer, IntPtr policyValue)
        {
            Pointer = pointer;
            policy = policyValue;
        }

        public static DesktopAppPolicy Create()
        {
            UIntPtr size = UIntPtr.Zero;
            if (InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size))
                throw new InvalidOperationException("Desktop app policy sizing unexpectedly succeeded");
            var sizingError = Marshal.GetLastWin32Error();
            if (sizingError != 122 || size == UIntPtr.Zero) throw new Win32Exception(sizingError);
            var list = Marshal.AllocHGlobal(checked((nint)size.ToUInt64()));
            var initialized = false;
            var policy = IntPtr.Zero;
            try
            {
                if (!InitializeProcThreadAttributeList(list, 1, 0, ref size))
                    throw new Win32Exception();
                initialized = true;
                policy = Marshal.AllocHGlobal(sizeof(uint));
                Marshal.WriteInt32(policy, unchecked((int)(BreakawayOverride | BreakawayDisableProcessTree)));
                if (!UpdateProcThreadAttribute(list, 0, Attribute, policy, (UIntPtr)sizeof(uint), IntPtr.Zero, IntPtr.Zero))
                    throw new Win32Exception();
                return new DesktopAppPolicy(list, policy);
            }
            catch
            {
                if (initialized) DeleteProcThreadAttributeList(list);
                if (policy != IntPtr.Zero) Marshal.FreeHGlobal(policy);
                Marshal.FreeHGlobal(list);
                throw;
            }
        }

        public void Dispose()
        {
            DeleteProcThreadAttributeList(Pointer);
            Marshal.FreeHGlobal(policy);
            Marshal.FreeHGlobal(Pointer);
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool InitializeProcThreadAttributeList(IntPtr attributeList, int attributeCount,
            uint flags, ref UIntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool UpdateProcThreadAttribute(IntPtr attributeList, uint flags, IntPtr attribute,
            IntPtr value, UIntPtr size, IntPtr previousValue, IntPtr returnSize);
        [DllImport("kernel32.dll")]
        private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);
    }

    private sealed class ChildEnvironment : IDisposable
    {
        private static readonly HashSet<string> Removed = new(StringComparer.OrdinalIgnoreCase)
        { "NODE_OPTIONS", "NODE_PATH", "NODE_REPL_EXTERNAL_MODULE", "NODE_EXTRA_CA_CERTS" };
        private readonly byte[] bytes;
        public IntPtr Pointer { get; }

        private ChildEnvironment(byte[] value)
        {
            bytes = value;
            Pointer = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, Pointer, bytes.Length);
        }
        public static ChildEnvironment Create()
        {
            var entries = Environment.GetEnvironmentVariables().Cast<DictionaryEntry>()
                .Where(entry => entry.Key is string key && !Removed.Contains(key))
                .Select(entry => $"{entry.Key}={entry.Value}")
                .OrderBy(entry => entry, StringComparer.OrdinalIgnoreCase);
            return new ChildEnvironment(Encoding.Unicode.GetBytes(string.Join("\0", entries) + "\0\0"));
        }
        public void Dispose()
        {
            CryptographicOperations.ZeroMemory(bytes);
            Marshal.Copy(bytes, 0, Pointer, bytes.Length);
            Marshal.FreeHGlobal(Pointer);
        }
    }
}

internal sealed class OwnedProcess(SafeFileHandle handle, int id) : IDisposable
{
    public int Id { get; } = id;
    public int Wait()
    {
        if (WaitForSingleObject(handle, uint.MaxValue) != 0) throw new Win32Exception();
        if (!GetExitCodeProcess(handle, out var code)) throw new Win32Exception();
        return unchecked((int)code);
    }
    public void Dispose() => handle.Dispose();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeFileHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(SafeFileHandle handle, out uint code);
}
