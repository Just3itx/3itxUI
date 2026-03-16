using Microsoft.Win32.SafeHandles;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
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
            if (command != "read") return;

            char[] separator = " ".ToCharArray();
            string[] splitted = data.Split(separator, count: 2, StringSplitOptions.None);
            command = splitted[0];
            data = splitted[1];

            if (command == "output")
            {
                string[] splitted2 = data.Split(separator, count: 2, StringSplitOptions.None);
                int type = int.Parse(splitted2[0]);
                string output = splitted2[1];

                SessionOutput?.Invoke(this, type, output);
            }
            else if (command == "error")
            {
                SessionOutput?.Invoke(this, 3, data);
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

            if (!WaitNamedPipe(initialPipe, 10))
                return false;

            SafeFileHandle handle = CreateFile(initialPipe, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);

            if (handle.IsInvalid) return false;

            uint mode = PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE;
            SetNamedPipeHandleState(handle, ref mode, IntPtr.Zero, IntPtr.Zero);

            byte[] newCmd = Encoding.UTF8.GetBytes("new");
            WriteFile(handle, newCmd, (uint)newCmd.Length, out _, IntPtr.Zero);
            ReadFile(handle, null, 0, out _, IntPtr.Zero);

            uint totalBytesAvail = 0;
            if (PeekNamedPipe(handle, null, 0, IntPtr.Zero, out totalBytesAvail, IntPtr.Zero) && totalBytesAvail > 0)
            {
                byte[] responseBuffer = new byte[totalBytesAvail];
                ReadFile(handle, responseBuffer, totalBytesAvail, out _, IntPtr.Zero);
                PipeName = Encoding.UTF8.GetString(responseBuffer);

                Thread runner = new Thread(SessionLoop);
                runner.IsBackground = true;
                runner.Start();

                handle.Close();
                return true;
            }

            handle.Close();
            return false;
        }

        private void SessionLoop()
        {
            try
            {
                while (true)
                {
                    if (!WaitNamedPipe(PipeName, -1))
                        continue;

                    using SafeFileHandle pipe = CreateFile(PipeName, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);

                    if (pipe.IsInvalid) continue;

                    uint mode = PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE;
                    SetNamedPipeHandleState(pipe, ref mode, IntPtr.Zero, IntPtr.Zero);

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
                        {
                            return;
                        }

                        foreach (var cmd in commandQueue)
                        {
                            byte[] cmdBytes = Encoding.UTF8.GetBytes(cmd);
                            WriteFile(pipe, cmdBytes, (uint)cmdBytes.Length, out _, IntPtr.Zero);
                            ReadFile(pipe, null, 0, out _, IntPtr.Zero);

                            uint size = 0;
                            if (PeekNamedPipe(pipe, null, 0, IntPtr.Zero, out size, IntPtr.Zero))
                            {
                                byte[] tempBuffer = new byte[size];
                                ReadFile(pipe, tempBuffer, size, out _, IntPtr.Zero);
                                string tempStr = Encoding.UTF8.GetString(tempBuffer);

                                if (ulong.TryParse(tempStr, out ulong numResponses))
                                {
                                    for (int i = 0; i < (int)numResponses; i++)
                                    {
                                        uint dataSize = 0;

                                        ReadFile(pipe, null, 0, out _, IntPtr.Zero);
                                        if (!PeekNamedPipe(pipe, null, 0, IntPtr.Zero, out dataSize, IntPtr.Zero))
                                            break;

                                        byte[] dataBuffer = new byte[dataSize];
                                        ReadFile(pipe, dataBuffer, dataSize, out _, IntPtr.Zero);
                                        string data = Encoding.UTF8.GetString(dataBuffer);

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
                        }

                        Thread.Sleep(5);
                    }
                }
            }
            finally
            {
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

    private static void InstancesTimerTick(object? source, ElapsedEventArgs e)
    {
        try
        {
            Process[] processes = Process.GetProcessesByName("RobloxPlayerBeta");

            for (int i = 0; i < processes.Length; i++)
            {
                Process process = processes[i];
                if (process == null) continue;

                if (Sessions.ContainsKey((uint)process.Id)) continue;

                if (!SynapseZAPI.IsSynz(process.Id)) continue;

                // Add new instance
                SynapseSession session = new SynapseSession();
                Sessions.TryAdd((uint)process.Id, session);

                Debug.WriteLine($"[SynapseZAPI2] New session detected for PID {process.Id}, initializing pipe...");

                if (session.Init((uint)process.Id))
                {
                    Debug.WriteLine($"[SynapseZAPI2] Session initialized for PID {process.Id}, pipe: {session.PipeName}");
                    SessionAdded?.Invoke(session);
                }
                else
                {
                    Debug.WriteLine($"[SynapseZAPI2] Failed to initialize session for PID {process.Id}");
                    Sessions.TryRemove((uint)process.Id, out _);
                }
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
}
