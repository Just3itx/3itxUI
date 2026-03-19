using Microsoft.Win32.SafeHandles;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Timers;

namespace _3itx_launcher;

public class SynapseZAPI2
{
    private static System.Timers.Timer? Timer;
    private static readonly ConcurrentDictionary<uint, SynapseSession> Sessions = new();

    public delegate void SynapseSessionEventHandler(SynapseSession e);
    public static event SynapseSessionEventHandler? SessionAdded;
    public static event SynapseSessionEventHandler? SessionRemoved;

    public delegate void SynapseConsoleEventHandler(SynapseSession e, int type, string output);
    public static event SynapseConsoleEventHandler? SessionOutput;

    public class SynapseSession
    {
        #region Win32 API Constants & Imports

        private const uint GENERIC_READ = 0x80000000;
        private const uint GENERIC_WRITE = 0x40000000;
        private const uint OPEN_EXISTING = 3;
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;
        private const uint PIPE_TYPE_MESSAGE = 0x00000004;
        private const uint PIPE_READMODE_MESSAGE = 0x00000002;

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern SafeFileHandle CreateFile(
            string lpFileName, uint dwDesiredAccess, uint dwShareMode,
            IntPtr lpSecurityAttributes, uint dwCreationDisposition,
            uint dwFlagsAndAttributes, IntPtr hTemplateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool WaitNamedPipe(string name, int timeout);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetNamedPipeHandleState(
            SafeFileHandle hNamedPipe, ref uint lpMode,
            IntPtr lpMaxCollectionCount, IntPtr lpCollectDataTimeout);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool PeekNamedPipe(
            SafeFileHandle hNamedPipe, byte[]? lpBuffer, uint nBufferSize,
            IntPtr lpBytesRead, out uint lpTotalBytesAvail, IntPtr lpBytesLeftThisMessage);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool WriteFile(
            SafeFileHandle hFile, byte[] lpBuffer, uint nNumberOfBytesToWrite,
            out uint lpNumberOfBytesWritten, IntPtr lpOverlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool ReadFile(
            SafeFileHandle hFile, byte[]? lpBuffer, uint nNumberOfBytesToRead,
            out uint lpNumberOfBytesRead, IntPtr lpOverlapped);

        #endregion

        public uint Pid { get; private set; }
        public string PipeName { get; private set; } = "";

        private readonly List<string> _pendingCommandQueue = new();
        private readonly List<Action<string, string, int>> _onMessageCallbacks = new();
        private readonly object _cycleLock = new();
        private readonly SynchronizationContext? _callerContext = SynchronizationContext.Current;

        public SynapseSession()
        {
            if (_callerContext != null)
            {
                AddOnMessageCallback(ConsoleOutput);
            }
            else
            {
                AddOnMessageCallback(ConsoleOutput__internal);
            }
        }

        public void QueueCommand(string command)
        {
            lock (_cycleLock)
            {
                _pendingCommandQueue.Add(command);
            }
        }

        public void Execute(string source) => QueueCommand($"execute {source}");

        public void ReloadSettingsInInternalUI() => QueueCommand("reload_settings");

        public void AddOnMessageCallback(Action<string, string, int> callback)
        {
            lock (_cycleLock)
            {
                _onMessageCallbacks.Add(callback);
            }
        }

        private void ConsoleOutput__internal(string command, string data, int i)
        {
            if (command != "read" || data == null) return;
            Debug.WriteLine($"[API2:Console] PID {Pid} raw data: cmd={command} data='{data}'");
            try
            {
                char[] separator = " ".ToCharArray();
                string[] splitted = data.Split(separator, count: 2, StringSplitOptions.None);
                if (splitted.Length < 2) return;
                command = splitted[0];
                data = splitted[1];

                if (command == "output")
                {
                    string[] splitted2 = data.Split(separator, count: 2, StringSplitOptions.None);
                    if (splitted2.Length < 2) return;
                    if (!int.TryParse(splitted2[0], out int type)) return;
                    string output = splitted2[1];

                    Debug.WriteLine($"[API2:Console] PID {Pid} FIRING SessionOutput: type={type} msg='{output}'");
                    SessionOutput?.Invoke(this, type, output ?? "");
                }
                else if (command == "error")
                {
                    Debug.WriteLine($"[API2:Console] PID {Pid} FIRING SessionOutput ERROR: msg='{data}'");
                    SessionOutput?.Invoke(this, 3, data ?? "");
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[SynapseZAPI2] ConsoleOutput parse error: {ex.Message}");
            }
        }

        private void ConsoleOutput(string command, string data, int i)
        {
            _callerContext!.Post(_ =>
            {
                ConsoleOutput__internal(command, data, i);
            }, null);
        }


        public bool Init(uint pid)
        {
            Pid = pid;
            string initialPipe = $@"\\.\pipe\synz-{pid}";
            Debug.WriteLine($"[API2:Init] Trying Win32 pipe: {initialPipe}");

            // Retry loop for WaitNamedPipe + CreateFile
            SafeFileHandle handle = null;
            for (int attempt = 0; attempt < 10; attempt++)
            {
                if (WaitNamedPipe(initialPipe, 1000))
                {
                    handle = CreateFile(initialPipe, GENERIC_READ | GENERIC_WRITE,
                        FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
                    if (!handle.IsInvalid) break;
                    handle = null;
                }
                Thread.Sleep(200);
            }

            if (handle == null || handle.IsInvalid)
            {
                Debug.WriteLine($"[API2:Init] Failed to connect to pipe for PID {pid}");
                return false;
            }

            uint mode = PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE;
            SetNamedPipeHandleState(handle, ref mode, IntPtr.Zero, IntPtr.Zero);

            // Send "new" command — exact reference protocol
            byte[] newCmd = Encoding.UTF8.GetBytes("new");
            WriteFile(handle, newCmd, (uint)newCmd.Length, out _, IntPtr.Zero);

            // Zero-byte ReadFile sync (critical — signals server to prepare session)
            ReadFile(handle, null, 0, out _, IntPtr.Zero);

            // Retry PeekNamedPipe to handle race condition
            uint totalBytesAvail = 0;
            for (int retry = 0; retry < 20; retry++)
            {
                if (PeekNamedPipe(handle, null, 0, IntPtr.Zero, out totalBytesAvail, IntPtr.Zero) && totalBytesAvail > 0)
                    break;
                Thread.Sleep(50);
            }

            if (totalBytesAvail > 0)
            {
                byte[] responseBuffer = new byte[totalBytesAvail];
                ReadFile(handle, responseBuffer, totalBytesAvail, out _, IntPtr.Zero);
                PipeName = Encoding.UTF8.GetString(responseBuffer);

                // Ensure full path for Win32 APIs
                if (!PipeName.StartsWith(@"\\"))
                    PipeName = $@"\\.\pipe\{PipeName}";

                Debug.WriteLine($"[API2:Init] Handshake OK for PID {pid}, session pipe: {PipeName}");

                handle.Close();

                Thread runner = new Thread(SessionLoop);
                runner.IsBackground = true;
                runner.Start();

                return true;
            }

            Debug.WriteLine($"[API2:Init] PeekNamedPipe returned 0 bytes after retries for PID {pid}");
            handle.Close();
            return false;
        }

        private void SessionLoop()
        {
            Debug.WriteLine($"[API2:SessionLoop] Starting for PID {Pid}, pipe: '{PipeName}'");
            try
            {
                while (true)
                {
                    if (!WaitNamedPipe(PipeName, 5000))
                    {
                        Thread.Sleep(500);
                        continue;
                    }

                    using SafeFileHandle pipe = CreateFile(PipeName, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);

                    if (pipe.IsInvalid)
                    {
                        Thread.Sleep(500);
                        continue;
                    }

                    uint mode = PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE;
                    SetNamedPipeHandleState(pipe, ref mode, IntPtr.Zero, IntPtr.Zero);
                    Debug.WriteLine($"[API2:SessionLoop] Connected to session pipe for PID {Pid}");

                    while (true)
                    {
                        List<string> commandQueue;

                        lock (_cycleLock)
                        {
                            commandQueue = new List<string>(_pendingCommandQueue);
                            _pendingCommandQueue.Clear();
                        }

                        commandQueue.Add("read");

                        string encoded = commandQueue.Count.ToString();
                        byte[] encodedBytes = Encoding.UTF8.GetBytes(encoded);

                        if (!WriteFile(pipe, encodedBytes, (uint)encodedBytes.Length, out _, IntPtr.Zero))
                            break;

                        foreach (var cmd in commandQueue)
                        {
                            byte[] cmdBytes = Encoding.UTF8.GetBytes(cmd);
                            if (!WriteFile(pipe, cmdBytes, (uint)cmdBytes.Length, out _, IntPtr.Zero))
                                break;

                            // Blocking read for response count
                            byte[] countBuf = new byte[65536];
                            if (!ReadFile(pipe, countBuf, (uint)countBuf.Length, out uint countBytesRead, IntPtr.Zero))
                                break;

                            string countStr = Encoding.UTF8.GetString(countBuf, 0, (int)countBytesRead);

                            if (ulong.TryParse(countStr, out ulong numResponses))
                            {
                                for (int i = 0; i < (int)numResponses; i++)
                                {
                                    byte[] dataBuf = new byte[65536];
                                    if (!ReadFile(pipe, dataBuf, (uint)dataBuf.Length, out uint dataBytesRead, IntPtr.Zero))
                                        break;

                                    string data = Encoding.UTF8.GetString(dataBuf, 0, (int)dataBytesRead);

                                    lock (_cycleLock)
                                    {
                                        foreach (var callback in _onMessageCallbacks)
                                        {
                                            callback(cmd, data, i);
                                        }
                                    }
                                }
                            }
                        }

                        Thread.Sleep(5);
                    }
                }
            }
            finally
            {
                Debug.WriteLine($"[API2:SessionLoop] Exiting for PID {Pid}");
                RemoveSession(Pid);
            }
        }
    }

    public static void StartInstancesTimer()
    {
        if (Timer != null) return;

        Timer = new System.Timers.Timer(2000);
        Timer.Elapsed += InstancesTimerTick;
        Timer.AutoReset = true;
        Timer.Enabled = true;
        Debug.WriteLine("[SynapseZAPI2] Instances timer started (2s interval)");
    }

    public static void StopInstancesTimer()
    {
        if (Timer == null) return;
        Timer.Enabled = false;
        Debug.WriteLine("[SynapseZAPI2] Instances timer stopped");
    }

    // Track PIDs that failed Init to avoid retrying every 2s (non-injected processes)
    private static readonly ConcurrentDictionary<uint, DateTime> _failedPids = new();

    private static void InstancesTimerTick(object? source, ElapsedEventArgs e)
    {
        try
        {
            Process[] processes = Process.GetProcessesByName("RobloxPlayerBeta");
            Debug.WriteLine($"[API2:Tick] Found {processes.Length} RobloxPlayerBeta process(es), {Sessions.Count} active session(s), {_failedPids.Count} failed PID(s)");

            for (int i = 0; i < processes.Length; i++)
            {
                Process process = processes[i];
                if (process == null) continue;

                uint pid = (uint)process.Id;
                if (Sessions.ContainsKey(pid)) continue;

                // Skip PIDs that recently failed Init (cooldown: 10s)
                if (_failedPids.TryGetValue(pid, out var lastFail) && (DateTime.UtcNow - lastFail).TotalSeconds < 10)
                {
                    continue;
                }

                Debug.WriteLine($"[API2:Tick] Attempting Init for PID {pid}...");

                // Try to connect directly — Init returns false if pipe doesn't exist
                SynapseSession session = new SynapseSession();
                Sessions.TryAdd(pid, session);

                if (session.Init(pid))
                {
                    _failedPids.TryRemove(pid, out _);
                    Debug.WriteLine($"[API2:Tick] ✓ Session initialized for PID {pid}, pipe: {session.PipeName}");
                    SessionAdded?.Invoke(session);
                }
                else
                {
                    Sessions.TryRemove(pid, out _);
                    _failedPids[pid] = DateTime.UtcNow;
                    Debug.WriteLine($"[API2:Tick] ✗ Init failed for PID {pid}, cooldown 10s");
                }
            }

            // Clean up stale failed entries for processes that no longer exist
            foreach (var pid in _failedPids.Keys)
            {
                try { Process.GetProcessById((int)pid); }
                catch { _failedPids.TryRemove(pid, out _); }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[SynapseZAPI2] Timer tick error: {ex.Message}");
        }
    }

    public static void Execute(string source, uint pid = 0)
    {
        if (pid == 0)
        {
            foreach (var pair in Sessions)
            {
                pair.Value.Execute(source);
            }
        }
        else
        {
            if (Sessions.TryGetValue(pid, out var session))
            {
                session.Execute(source);
            }
        }
    }

    public static ConcurrentDictionary<uint, SynapseSession> GetInstances()
    {
        return Sessions;
    }

    internal static void RemoveSession(uint pid)
    {
        if (Sessions.TryRemove(pid, out var session))
        {
            Debug.WriteLine($"[SynapseZAPI2] Session removed for PID {pid}");
            SessionRemoved?.Invoke(session);
        }
    }

    public static bool TryGetSession(uint pid, out SynapseSession session)
    {
        return Sessions.TryGetValue(pid, out session!);
    }
}
