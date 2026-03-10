using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media.Animation;
using Microsoft.Web.WebView2.Core;

namespace _3itx_launcher;

public partial class MainWindow : Window
{
    private Process? _serverProcess;
    private readonly string _uiPath;
    private readonly string _dataPath;
    private const string ServerUrl = "http://localhost:9367";
    private const int MaxRetries = 240;
    private const int WsPort = 24892;
    private const string CurrentVersion = "1.0.1";
    private const string VersionCheckUrl = "https://raw.githubusercontent.com/Just3itx/3itxUI/refs/heads/main/Verison.json";
    private const string ReleasesUrl = "https://github.com/Just3itx/3itxUI/releases/tag/Latest";

    /* ─── WebSocket client tracking ─── */
    private HttpListener? _wsListener;
    private readonly ConcurrentDictionary<string, WsClient> _wsClients = new();
    private CancellationTokenSource _wsCts = new();
    private Timer? _pollTimer;
    private Timer? _pingTimer;
    private readonly HashSet<int> _injectedPids = new();
    private static readonly Random _rng = new();
    private static readonly HttpClient _httpClient = new();
    private bool _consoleRedirectEnabled = false;
    private bool _lspConnectEnabled = false;
    private bool _unlockFPSEnabled = false;

    private class WsClient
    {
        public WebSocket Socket { get; set; } = null!;
        public int Pid { get; set; }
        public long UserId { get; set; }
        public string Username { get; set; } = "";
        public string DisplayName { get; set; } = "";
        public long PlaceId { get; set; }
        public string PlaceName { get; set; } = "";
        public string JobId { get; set; } = "";
        public string Status { get; set; } = "connected";
        public DateTime LastPong { get; set; } = DateTime.UtcNow;
        public string AvatarUrl { get; set; } = "";
    }

    /* ─── Win32 for Windows 11 rounded corners ─── */
    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWCP_ROUND = 2;

    public MainWindow()
    {
        InitializeComponent();

        var exeDir = AppDomain.CurrentDomain.BaseDirectory;
        // Try multiple relative paths to find 3itx-ui
        // bin\Debug\net8.0-windows\ → 4 levels up; bin\publish\ → 3 levels up
        _uiPath = "";
        string[] candidates = {
            Path.Combine(exeDir, "3itx-ui"),                                           // next to exe
            Path.Combine(exeDir, "bin", "3itx-ui"),                                    // in bin/ subfolder
            Path.GetFullPath(Path.Combine(exeDir, "..", "..", "..", "3itx-ui")),       // bin\publish
            Path.GetFullPath(Path.Combine(exeDir, "..", "..", "..", "..", "3itx-ui")), // bin\Debug\net*
        };
        foreach (var p in candidates)
        {
            if (Directory.Exists(p)) { _uiPath = p; break; }
        }
        if (string.IsNullOrEmpty(_uiPath))
            _uiPath = candidates[0]; // fallback for error message

        // Create Scripts and AutoExec folders in %LOCALAPPDATA%\3itx_UI
        _dataPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "3itx_UI");
        if (!Directory.Exists(_dataPath)) Directory.CreateDirectory(_dataPath);
        var scriptsDir = Path.Combine(_dataPath, "Scripts");
        var autoExecDir = Path.Combine(_dataPath, "AutoExec");
        if (!Directory.Exists(scriptsDir)) Directory.CreateDirectory(scriptsDir);
        if (!Directory.Exists(autoExecDir)) Directory.CreateDirectory(autoExecDir);

        StartSpinner();

        Loaded += MainWindow_Loaded;
        Closing += MainWindow_Closing;
        SourceInitialized += MainWindow_SourceInitialized;
    }

    /* ─── Windows 11 rounded corners ─── */
    private void MainWindow_SourceInitialized(object? sender, EventArgs e)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        var pref = DWMWCP_ROUND;
        DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref pref, sizeof(int));
    }

    /* ─── Native title bar drag ─── */
    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
        {
            WindowState = WindowState == WindowState.Maximized
                ? WindowState.Normal : WindowState.Maximized;
        }
        else
        {
            DragMove();
        }
    }

    /* ─── Window button handlers ─── */
    private void Minimize_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState.Minimized;

    private void Maximize_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState == WindowState.Maximized
            ? WindowState.Normal : WindowState.Maximized;

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    /* ─── Spinner ─── */
    private void StartSpinner()
    {
        var anim = new DoubleAnimation(0, 360, TimeSpan.FromMilliseconds(900))
        {
            RepeatBehavior = RepeatBehavior.Forever,
        };
        SpinnerRotation.BeginAnimation(System.Windows.Media.RotateTransform.AngleProperty, anim);
    }

    /* ─── Lifecycle ─── */
    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        UpdateStatus("Checking for updates...", 5);
        await CheckForUpdates();

        UpdateStatus("Checking UI project...", 10);

        if (!Directory.Exists(_uiPath))
        {
            UpdateStatus($"Error: UI not found at {_uiPath}", 0);
            MessageBox.Show(
                $"Could not find 3itx-ui project at:\n{_uiPath}\n\nPlace the 3itx-ui folder next to the launcher.",
                "3itx UI", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        UpdateStatus("Checking for existing server...", 15);
        if (await IsServerReady())
        {
            UpdateStatus("Server already running!", 90);
            await InitWebView();
            return;
        }

        UpdateStatus("Starting Next.js server...", 20);
        StartServer();

        UpdateStatus("Waiting for server...", 30);
        if (!await WaitForServer())
        {
            UpdateStatus("Failed to start server.", 0);
            MessageBox.Show(
                "Could not connect to the dev server.\nMake sure npm dependencies are installed:\n\ncd 3itx-ui && npm install",
                "3itx UI", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        UpdateStatus("Loading UI...", 85);
        await InitWebView();
    }

    /* ─── Version Check ─── */
    private async Task CheckForUpdates()
    {
        try
        {
            var json = await _httpClient.GetStringAsync(VersionCheckUrl);
            using var doc = JsonDocument.Parse(json);
            var remoteVersion = doc.RootElement.GetProperty("Version").GetString() ?? "";

            if (remoteVersion != CurrentVersion && !string.IsNullOrEmpty(remoteVersion))
            {
                var result = MessageBox.Show(
                    $"A new version is available!\n\nCurrent: {CurrentVersion}\nLatest: {remoteVersion}\n\nWould you like to update?",
                    "3itx UI — Update Available",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Information);

                if (result == MessageBoxResult.Yes)
                {
                    Process.Start(new ProcessStartInfo(ReleasesUrl) { UseShellExecute = true });
                    Application.Current.Shutdown();
                    return;
                }
                // User clicked No → continue with current version
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Version] Check failed: {ex.Message}");
            // Silently continue if version check fails (no internet etc.)
        }
    }

    private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        KillServer();
    }

    /* ─── Server ─── */
    private void StartServer()
    {
        try
        {
            Debug.WriteLine($"[Server] Starting npm dev server in: {_uiPath}");
            UpdateStatus($"Starting server in {_uiPath}", 15);

            _serverProcess = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c npm run dev",
                    WorkingDirectory = _uiPath,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    // Ensure npm can be found
                    EnvironmentVariables = { }
                }
            };
            // Inherit all environment variables (PATH etc.)
            _serverProcess.StartInfo.UseShellExecute = false;
            _serverProcess.OutputDataReceived += (_, args) =>
            {
                if (!string.IsNullOrEmpty(args.Data))
                    Debug.WriteLine($"[Server:out] {args.Data}");
            };
            _serverProcess.ErrorDataReceived += (_, args) =>
            {
                if (!string.IsNullOrEmpty(args.Data))
                    Debug.WriteLine($"[Server:err] {args.Data}");
            };
            _serverProcess.Start();
            Debug.WriteLine($"[Server] Process started, PID: {_serverProcess.Id}");
            _serverProcess.BeginOutputReadLine();
            _serverProcess.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Server] Failed to start: {ex}");
            UpdateStatus($"Error: {ex.Message}", 0);
        }
    }

    private void KillServer()
    {
        if (_serverProcess is { HasExited: false })
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "taskkill",
                    Arguments = $"/T /F /PID {_serverProcess.Id}",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                })?.WaitForExit(3000);
            }
            catch { }
        }
    }

    private static async Task<bool> IsServerReady()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            var r = await client.GetAsync(ServerUrl);
            return r.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    private async Task<bool> WaitForServer()
    {
        for (int i = 0; i < MaxRetries; i++)
        {
            if (await IsServerReady()) return true;
            UpdateStatus($"Waiting for server... ({(i + 1) / 2}s)", 30 + (int)(55.0 * i / MaxRetries));
            await Task.Delay(500);
        }
        return false;
    }

    /* ─── WebView2 ─── */
    private async Task InitWebView()
    {
        UpdateStatus("Initializing WebView2...", 90);

        var userDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "3itx-ui", "WebView2");

        var env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
        await WebView.EnsureCoreWebView2Async(env);

        var settings = WebView.CoreWebView2.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = true; // temporarily enabled for debugging
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;

        UpdateStatus("Ready.", 100);
        WebView.CoreWebView2.Navigate(ServerUrl);

        // Start WebSocket server and process polling
        _ = Task.Run(() => StartWsServer(_wsCts.Token));
        _pollTimer = new Timer(_ => PollRobloxProcesses(), null, 3000, 3000);
        _pingTimer = new Timer(_ => PingAllClients(), null, 5000, 5000);

        // ─── File system bridge via WebView2 messages ───
        var logPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bridge_debug.log");
        WebView.CoreWebView2.WebMessageReceived += async (s, e) =>
        {
            try
            {
                File.AppendAllText(logPath, $"[{DateTime.Now:HH:mm:ss}] RAW: {e.WebMessageAsJson?.Substring(0, Math.Min(e.WebMessageAsJson?.Length ?? 0, 300))}\n");
                var msg = System.Text.Json.JsonDocument.Parse(e.WebMessageAsJson);
                var root = msg.RootElement;
                if (!root.TryGetProperty("action", out var actionProp)) return;
                var action = actionProp.GetString();
                var requestId = root.TryGetProperty("requestId", out var rid) ? rid.GetString() : "";
                var section = root.TryGetProperty("root", out var rp) ? rp.GetString() : "scripts";
                var filePath = root.TryGetProperty("filePath", out var fp) ? fp.GetString() : "";

                var exeBaseDir = AppDomain.CurrentDomain.BaseDirectory;
                var baseDir = section == "autoexec"
                    ? Path.Combine(_dataPath, "AutoExec")
                    : Path.Combine(_dataPath, "Scripts");
                if (!Directory.Exists(baseDir)) Directory.CreateDirectory(baseDir);

                File.AppendAllText(logPath, $"[{DateTime.Now:HH:mm:ss}] ACTION: {action}, baseDir: {baseDir}\n");

                string result = "{}";

                switch (action)
                {
                    case "listFiles":
                        result = BuildTreeJson(baseDir);
                        break;

                    case "readFile":
                        var readPath = Path.Combine(baseDir, filePath ?? "");
                        if (!readPath.StartsWith(baseDir)) { result = "{\"error\":\"denied\"}"; break; }
                        if (File.Exists(readPath))
                            result = System.Text.Json.JsonSerializer.Serialize(new { content = File.ReadAllText(readPath) });
                        else
                            result = "{\"error\":\"not found\"}";
                        break;

                    case "writeFile":
                        var writePath = Path.Combine(baseDir, filePath ?? "");
                        if (!writePath.StartsWith(baseDir)) { result = "{\"error\":\"denied\"}"; break; }
                        var dir = Path.GetDirectoryName(writePath);
                        if (dir != null && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                        var content = root.TryGetProperty("content", out var cp) ? cp.GetString() : "";
                        File.WriteAllText(writePath, content ?? "");
                        result = "{\"ok\":true}";
                        break;

                    case "createFile":
                        var cfPath = Path.Combine(baseDir, filePath ?? "");
                        if (!cfPath.StartsWith(baseDir)) { result = "{\"error\":\"denied\"}"; break; }
                        var cfDir = Path.GetDirectoryName(cfPath);
                        if (cfDir != null && !Directory.Exists(cfDir)) Directory.CreateDirectory(cfDir);
                        if (!File.Exists(cfPath)) File.WriteAllText(cfPath, "");
                        result = "{\"ok\":true}";
                        break;

                    case "createFolder":
                        var cdPath = Path.Combine(baseDir, filePath ?? "");
                        if (!cdPath.StartsWith(baseDir)) { result = "{\"error\":\"denied\"}"; break; }
                        Directory.CreateDirectory(cdPath);
                        result = "{\"ok\":true}";
                        break;

                    case "deleteFile":
                        var delPath = Path.Combine(baseDir, filePath ?? "");
                        if (!delPath.StartsWith(baseDir)) { result = "{\"error\":\"denied\"}"; break; }
                        if (File.Exists(delPath)) File.Delete(delPath);
                        else if (Directory.Exists(delPath)) Directory.Delete(delPath, true);
                        result = "{\"ok\":true}";
                        break;

                    case "rename":
                        var oldPath = Path.Combine(baseDir, filePath ?? "");
                        var newName = root.TryGetProperty("newName", out var nn) ? nn.GetString() : "";
                        if (!oldPath.StartsWith(baseDir) || string.IsNullOrEmpty(newName)) { result = "{\"error\":\"denied\"}"; break; }
                        var newPath = Path.Combine(Path.GetDirectoryName(oldPath)!, newName!);
                        if (!newPath.StartsWith(baseDir)) { result = "{\"error\":\"denied\"}"; break; }
                        if (File.Exists(oldPath)) File.Move(oldPath, newPath);
                        else if (Directory.Exists(oldPath)) Directory.Move(oldPath, newPath);
                        result = "{\"ok\":true}";
                        break;

                    case "openFolder":
                        var openPath = string.IsNullOrEmpty(filePath) ? baseDir : Path.Combine(baseDir, filePath);
                        if (Directory.Exists(openPath))
                            System.Diagnostics.Process.Start("explorer.exe", openPath);
                        else
                            System.Diagnostics.Process.Start("explorer.exe", baseDir);
                        result = "{\"ok\":true}";
                        break;

                    case "moveToSection":
                        var toSection = root.TryGetProperty("toRoot", out var tr) ? tr.GetString() : "";
                        var destBaseDir = toSection == "autoexec"
                            ? Path.Combine(_dataPath, "AutoExec")
                            : Path.Combine(_dataPath, "Scripts");
                        if (!Directory.Exists(destBaseDir)) Directory.CreateDirectory(destBaseDir);
                        var srcPath = Path.Combine(baseDir, filePath ?? "");
                        var dstPath = Path.Combine(destBaseDir, Path.GetFileName(filePath ?? ""));
                        if (!srcPath.StartsWith(baseDir) || !dstPath.StartsWith(destBaseDir))
                        { result = "{\"error\":\"denied\"}"; break; }
                        if (File.Exists(srcPath)) File.Move(srcPath, dstPath, true);
                        else if (Directory.Exists(srcPath))
                        {
                            if (Directory.Exists(dstPath)) Directory.Delete(dstPath, true);
                            Directory.Move(srcPath, dstPath);
                        }
                        result = "{\"ok\":true}";
                        break;

                    case "moveInFolder":
                        var toFolder = root.TryGetProperty("toFolder", out var tf) ? tf.GetString() : "";
                        var moveFrom = Path.Combine(baseDir, filePath ?? "");
                        var moveTo = string.IsNullOrEmpty(toFolder)
                            ? Path.Combine(baseDir, Path.GetFileName(filePath ?? ""))
                            : Path.Combine(baseDir, toFolder, Path.GetFileName(filePath ?? ""));
                        if (!moveFrom.StartsWith(baseDir) || !moveTo.StartsWith(baseDir))
                        { result = "{\"error\":\"denied\"}"; break; }
                        var moveToDir = Path.GetDirectoryName(moveTo);
                        if (moveToDir != null && !Directory.Exists(moveToDir)) Directory.CreateDirectory(moveToDir);
                        if (File.Exists(moveFrom)) File.Move(moveFrom, moveTo, true);
                        else if (Directory.Exists(moveFrom))
                        {
                            if (Directory.Exists(moveTo)) Directory.Delete(moveTo, true);
                            Directory.Move(moveFrom, moveTo);
                        }
                        result = "{\"ok\":true}";
                        break;

                    case "syncAutoExec":
                        var enableStr = root.TryGetProperty("enable", out var en) ? en.GetString() : "false";
                        var enable = enableStr == "true";
                        var synapseAutoExec = Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                            "Synapse Z", "autoexec");
                        if (!Directory.Exists(synapseAutoExec)) Directory.CreateDirectory(synapseAutoExec);
                        
                        if (enable)
                        {
                            // Copy all files from our AutoExec folder to Synapse Z autoexec with 3itx_ prefix
                            var autoExecDir = Path.Combine(_dataPath, "AutoExec");
                            if (Directory.Exists(autoExecDir))
                            {
                                foreach (var file in Directory.GetFiles(autoExecDir, "*.*", SearchOption.TopDirectoryOnly))
                                {
                                    var fname = Path.GetFileName(file);
                                    var destFile = Path.Combine(synapseAutoExec, $"3itx_{fname}");
                                    File.Copy(file, destFile, true);
                                }
                            }
                        }
                        else
                        {
                            // Remove all 3itx_ prefixed files from Synapse Z autoexec
                            foreach (var file in Directory.GetFiles(synapseAutoExec, "3itx_*"))
                            {
                                File.Delete(file);
                            }
                        }
                        result = "{\"ok\":true}";
                        break;

                    case "openExternalFolder":
                        var folderKey = root.TryGetProperty("folderKey", out var fk) ? fk.GetString() : "";
                        var targetDir = folderKey switch
                        {
                            "synapseAutoExec" => Path.Combine(
                                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                "Synapse Z", "autoexec"),
                            "synapseWorkspace" => Path.Combine(
                                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                "Synapse Z", "workspace"),
                            "scripts" => Path.Combine(_dataPath, "Scripts"),
                            "autoexec" => Path.Combine(_dataPath, "AutoExec"),
                            _ => ""
                        };
                        if (!string.IsNullOrEmpty(targetDir))
                        {
                            if (!Directory.Exists(targetDir)) Directory.CreateDirectory(targetDir);
                            System.Diagnostics.Process.Start("explorer.exe", targetDir);
                        }
                        result = "{\"ok\":true}";
                        break;

                    case "getClients":
                        result = BuildClientsJson();
                        break;

                    case "executeOnClients":
                        var scriptToExec = root.TryGetProperty("script", out var sc) ? sc.GetString() ?? "" : "";
                        if (root.TryGetProperty("pids", out var pidsArr) && pidsArr.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var pidEl in pidsArr.EnumerateArray())
                            {
                                var targetPid = pidEl.GetInt32();
                                // Prefer WebSocket for error capture, fall back to scheduler
                                var wsClient = _wsClients.Values.FirstOrDefault(c => c.Pid == targetPid && c.Socket.State == WebSocketState.Open);
                                if (wsClient != null)
                                {
                                    _ = SendExecuteToWs(wsClient, scriptToExec);
                                }
                                else
                                {
                                    SynzExecute(scriptToExec, targetPid);
                                }
                            }
                        }
                        result = "{\"ok\":true}";
                        break;

                    case "killClient":
                        var killPid = root.TryGetProperty("pid", out var kp) ? kp.GetInt32() : 0;
                        if (killPid > 0)
                        {
                            try
                            {
                                var proc = Process.GetProcessById(killPid);
                                proc.Kill();
                            }
                            catch { }
                        }
                        result = "{\"ok\":true}";
                        break;

                    case "refreshClients":
                        PollRobloxProcesses();
                        result = BuildClientsJson();
                        break;

                    case "setConsoleRedirect":
                    {
                        var crEnabled = root.TryGetProperty("enabled", out var crEn) && crEn.GetBoolean();
                        _consoleRedirectEnabled = crEnabled;
                        var redirectPayload = Encoding.UTF8.GetBytes(
                            $"{{\"type\":\"enableConsoleRedirect\",\"enabled\":{(crEnabled ? "true" : "false")}}}");
                        foreach (var kv in _wsClients)
                        {
                            if (kv.Value.Socket.State == WebSocketState.Open)
                            {
                                try
                                {
                                    _ = kv.Value.Socket.SendAsync(
                                        new ArraySegment<byte>(redirectPayload),
                                        WebSocketMessageType.Text, true, CancellationToken.None);
                                }
                                catch { }
                            }
                        }
                        result = "{\"ok\":true}";
                        break;
                    }

                    case "launchRoblox":
                    {
                        try
                        {
                            var lnkPath = Path.Combine(
                                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                                @"Microsoft\Windows\Start Menu\Programs\Roblox\Roblox Player.lnk");
                            if (File.Exists(lnkPath))
                            {
                                Process.Start(new ProcessStartInfo { FileName = lnkPath, UseShellExecute = true });
                                result = "{\"ok\":true}";
                            }
                            else
                            {
                                Debug.WriteLine($"[Launch] Roblox shortcut not found: {lnkPath}");
                                result = "{\"ok\":false,\"error\":\"Roblox shortcut not found\"}";
                            }
                        }
                        catch (Exception ex)
                        {
                            Debug.WriteLine($"[Launch] Error: {ex.Message}");
                            result = "{\"ok\":false,\"error\":\"Failed to launch Roblox\"}";
                        }
                        break;
                    }

                    case "setLSPConnect":
                    {
                        var lspEnabled = root.TryGetProperty("enabled", out var lspEn) && lspEn.GetBoolean();
                        _lspConnectEnabled = lspEnabled;
                        var lspPayload = Encoding.UTF8.GetBytes(
                            $"{{\"type\":\"enableLSP\",\"enabled\":{(lspEnabled ? "true" : "false")}}}");
                        foreach (var kv in _wsClients)
                        {
                            if (kv.Value.Socket.State == WebSocketState.Open)
                            {
                                try
                                {
                                    _ = kv.Value.Socket.SendAsync(
                                        new ArraySegment<byte>(lspPayload),
                                        WebSocketMessageType.Text, true, CancellationToken.None);
                                }
                                catch { }
                            }
                        }
                        result = "{\"ok\":true}";
                        break;
                    }

                    case "setUnlockFPS":
                    {
                        var fpsEnabled = root.TryGetProperty("enabled", out var fpsEn) && fpsEn.GetBoolean();
                        _unlockFPSEnabled = fpsEnabled;
                        var fpsScript = fpsEnabled ? "setfpscap(math.huge)" : "setfpscap(60)";
                        var fpsPayload = Encoding.UTF8.GetBytes(
                            $"{{\"type\":\"execute\",\"code\":\"{fpsScript}\"}}");
                        foreach (var kv in _wsClients)
                        {
                            if (kv.Value.Socket.State == WebSocketState.Open)
                            {
                                try
                                {
                                    _ = kv.Value.Socket.SendAsync(
                                        new ArraySegment<byte>(fpsPayload),
                                        WebSocketMessageType.Text, true, CancellationToken.None);
                                }
                                catch { }
                            }
                        }
                        result = "{\"ok\":true}";
                        break;
                    }

                    case "setTopMost":
                    {
                        var topMostEnabled = root.TryGetProperty("enabled", out var tmEn) && tmEn.GetBoolean();
                        Dispatcher.Invoke(() => { Topmost = topMostEnabled; });
                        result = "{\"ok\":true}";
                        break;
                    }
                }

                var response = $"{{\"requestId\":\"{requestId}\",\"data\":{result}}}";
                File.AppendAllText(logPath, $"[{DateTime.Now:HH:mm:ss}] RESPONSE: {response.Substring(0, Math.Min(response.Length, 300))}\n");
                // Push response onto queue, then drain — queue survives before JS module loads
                var jsPayload = System.Text.Json.JsonSerializer.Serialize(response);
                var jsCode = $@"
                    try {{
                        var resp = JSON.parse({jsPayload});
                        console.log('[BRIDGE] Pushing response, requestId:', resp.requestId, 'dataType:', typeof resp.data, 'isArray:', Array.isArray(resp.data));
                        (window.__bridgeQueue = window.__bridgeQueue || []).push(resp);
                        if (typeof window.__bridgeDrain === 'function') {{
                            console.log('[BRIDGE] Calling __bridgeDrain, pending size:', window.__bridgePending ? window.__bridgePending.size : 'undefined');
                            window.__bridgeDrain();
                            console.log('[BRIDGE] After drain, pending size:', window.__bridgePending ? window.__bridgePending.size : 'undefined');
                        }} else {{
                            console.log('[BRIDGE] __bridgeDrain not defined yet, queued for later');
                        }}
                    }} catch(e) {{
                        console.error('[BRIDGE] ExecuteScript error:', e.message, e.stack);
                    }}
                ";
                await Dispatcher.InvokeAsync(async () =>
                    await WebView.CoreWebView2.ExecuteScriptAsync(jsCode));
            }
            catch (Exception ex) 
            { 
                File.AppendAllText(logPath, $"[{DateTime.Now:HH:mm:ss}] ERROR: {ex.Message}\n{ex.StackTrace}\n");
            }
        };

        WebView.NavigationCompleted += async (s, args) =>
        {
            if (args.IsSuccess)
            {
                // Initialize bridge queue before any JS modules load
                await WebView.CoreWebView2.ExecuteScriptAsync("window.__bridgeQueue = window.__bridgeQueue || [];");

                // Hide the web title bar since we have a native WPF one
                await WebView.CoreWebView2.ExecuteScriptAsync(@"
                    (function() {
                        var style = document.createElement('style');
                        style.textContent = '[class*=""glass-heavy""]:first-child { display: none !important; }';
                        document.head.appendChild(style);

                        // Also try to hide by finding the title bar div
                        var els = document.querySelectorAll('div');
                        for (var i = 0; i < els.length; i++) {
                        if (els[i].textContent.indexOf('3itx') !== -1 && els[i].querySelector('button')) {
                                if (els[i].classList.contains('shrink-0') && els[i].offsetHeight < 50) {
                                    els[i].style.display = 'none';
                                    break;
                                }
                            }
                        }
                    })();
                ");

                await Dispatcher.InvokeAsync(() =>
                {
                    WebView.Visibility = Visibility.Visible;
                    LoadingOverlay.Visibility = Visibility.Collapsed;
                });
            }
        };
    }

    private string BuildTreeJson(string dirPath)
    {
        if (!Directory.Exists(dirPath)) return "[]";
        var sb = new System.Text.StringBuilder();
        sb.Append('[');
        BuildTreeEntries(sb, dirPath, true);
        sb.Append(']');
        return sb.ToString();
    }

    private void BuildTreeEntries(System.Text.StringBuilder sb, string dirPath, bool isFirst)
    {
        var entries = Directory.GetFileSystemEntries(dirPath);
        foreach (var entry in entries.OrderBy(e => !Directory.Exists(e)).ThenBy(e => Path.GetFileName(e)))
        {
            var name = Path.GetFileName(entry);
            var escaped = name.Replace("\\", "\\\\").Replace("\"", "\\\"");
            if (Directory.Exists(entry))
            {
                if (!isFirst) sb.Append(',');
                isFirst = false;
                sb.Append($"{{\"id\":\"dir_{escaped}\",\"name\":\"{escaped}\",\"type\":\"folder\",\"children\":");
                sb.Append('[');
                BuildTreeEntries(sb, entry, true);
                sb.Append("]}");
            }
            else if (name.EndsWith(".lua", StringComparison.OrdinalIgnoreCase) ||
                     name.EndsWith(".luau", StringComparison.OrdinalIgnoreCase) ||
                     name.EndsWith(".txt", StringComparison.OrdinalIgnoreCase))
            {
                if (!isFirst) sb.Append(',');
                isFirst = false;
                sb.Append($"{{\"id\":\"file_{escaped}\",\"name\":\"{escaped}\",\"type\":\"file\"}}");
            }
            // Skip non-matching files without advancing isFirst
        }
    }

    /* ─── Loading UI ─── */
    private void UpdateStatus(string text, int pct)
    {
        Dispatcher.Invoke(() =>
        {
            StatusText.Text = text;
            ProgressBar.BeginAnimation(WidthProperty,
                new DoubleAnimation(200.0 * pct / 100.0, TimeSpan.FromMilliseconds(300))
                { EasingFunction = new QuadraticEase() });
        });
    }

    /* ═══════════════════════════════════════════════════════════════════
       WebSocket Server — Roblox instances connect here via init script
       ═══════════════════════════════════════════════════════════════════ */

    private async Task StartWsServer(CancellationToken ct)
    {
        _wsListener = new HttpListener();
        _wsListener.Prefixes.Add($"http://localhost:{WsPort}/");
        try { _wsListener.Start(); }
        catch (Exception ex)
        {
            Debug.WriteLine($"[WS] Failed to start: {ex.Message}");
            return;
        }
        Debug.WriteLine($"[WS] Server listening on port {WsPort}");

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var ctx = await _wsListener.GetContextAsync();
                if (!ctx.Request.IsWebSocketRequest)
                {
                    ctx.Response.StatusCode = 400;
                    ctx.Response.Close();
                    continue;
                }
                var wsCtx = await ctx.AcceptWebSocketAsync(null);
                _ = Task.Run(() => HandleWsClient(wsCtx.WebSocket, ct));
            }
            catch (ObjectDisposedException) { break; }
            catch (Exception ex) { Debug.WriteLine($"[WS] Accept error: {ex.Message}"); }
        }
    }

    private async Task HandleWsClient(WebSocket ws, CancellationToken ct)
    {
        string clientId = Guid.NewGuid().ToString("N")[..8];
        var buffer = new byte[4096];
        try
        {
            // Wait for hello message
            var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
            if (result.MessageType == WebSocketMessageType.Close) return;

            var msg = Encoding.UTF8.GetString(buffer, 0, result.Count);
            var hello = JsonDocument.Parse(msg).RootElement;

            if (hello.TryGetProperty("type", out var t) && t.GetString() == "hello")
            {
                var client = new WsClient
                {
                    Socket = ws,
                    Pid = hello.TryGetProperty("pid", out var p) ? p.GetInt32() : 0,
                    UserId = hello.TryGetProperty("userId", out var u) ? u.GetInt64() : 0,
                    Username = hello.TryGetProperty("username", out var un) ? un.GetString() ?? "" : "",
                    DisplayName = hello.TryGetProperty("displayName", out var dn) ? dn.GetString() ?? "" : "",
                    PlaceId = hello.TryGetProperty("placeId", out var pl) ? pl.GetInt64() : 0,
                    PlaceName = hello.TryGetProperty("placeName", out var pn) ? pn.GetString() ?? "" : "",
                    JobId = hello.TryGetProperty("jobId", out var jid) ? jid.GetString() ?? "" : "",
                    Status = "connected"
                };
                clientId = $"ws_{client.Pid}";
                _wsClients[clientId] = client;
                Debug.WriteLine($"[WS] Client connected: {client.Username} (PID {client.Pid})");
                // Fetch avatar URL asynchronously
                _ = Task.Run(async () =>
                {
                    client.AvatarUrl = await FetchAvatarUrl(client.UserId);
                    PushClientListToUi();
                });
                PushClientListToUi();

                // Send current settings to newly connected client
                try
                {
                    if (_consoleRedirectEnabled)
                    {
                        var crMsg = Encoding.UTF8.GetBytes("{\"type\":\"enableConsoleRedirect\",\"enabled\":true}");
                        await ws.SendAsync(new ArraySegment<byte>(crMsg), WebSocketMessageType.Text, true, ct);
                    }
                    if (_lspConnectEnabled)
                    {
                        var lspMsg = Encoding.UTF8.GetBytes("{\"type\":\"enableLSP\",\"enabled\":true}");
                        await ws.SendAsync(new ArraySegment<byte>(lspMsg), WebSocketMessageType.Text, true, ct);
                    }
                    if (_unlockFPSEnabled)
                    {
                        var fpsMsg = Encoding.UTF8.GetBytes("{\"type\":\"execute\",\"code\":\"setfpscap(math.huge)\"}");
                        await ws.SendAsync(new ArraySegment<byte>(fpsMsg), WebSocketMessageType.Text, true, ct);
                    }
                }
                catch { }
            }

            // Keep connection alive — listen for messages (pong responses + log + LSP)
            var msgBuffer = new System.IO.MemoryStream();
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close) break;

                // Accumulate fragmented messages
                msgBuffer.Write(buffer, 0, result.Count);
                if (!result.EndOfMessage) continue;

                var incoming = Encoding.UTF8.GetString(msgBuffer.ToArray());
                msgBuffer.SetLength(0);

                // Parse incoming messages
                try
                {
                    var inDoc = JsonDocument.Parse(incoming).RootElement;
                    if (inDoc.TryGetProperty("type", out var inType))
                    {
                        var typeStr = inType.GetString();
                        if (typeStr == "pong" && _wsClients.TryGetValue(clientId, out var cl))
                        {
                            cl.LastPong = DateTime.UtcNow;
                            if (cl.Status != "connected")
                            {
                                cl.Status = "connected";
                                PushClientListToUi();
                            }
                        }
                        else if (typeStr == "log" && _wsClients.TryGetValue(clientId, out var logClient))
                        {
                            var level = inDoc.TryGetProperty("level", out var lv) ? lv.GetString() ?? "info" : "info";
                            var message = inDoc.TryGetProperty("message", out var lm) ? lm.GetString() ?? "" : "";
                            PushLogToUi(logClient.DisplayName, logClient.Pid, level, message);
                        }
                        else if (typeStr != null && typeStr.StartsWith("lsp_") && _wsClients.TryGetValue(clientId, out var lspClient))
                        {
                            PushLspToUi(lspClient.Pid, incoming);
                        }
                    }
                }
                catch { }
            }
            msgBuffer.Dispose();
        }
        catch (WebSocketException) { }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Debug.WriteLine($"[WS] Client error: {ex.Message}"); }
        finally
        {
            // Remove client and clear PID so it can be re-injected on rejoin
            if (_wsClients.TryRemove(clientId, out var removed))
            {
                _injectedPids.Remove(removed.Pid);
                Debug.WriteLine($"[WS] Client disconnected: {clientId} (PID {removed.Pid}) — cleared for re-injection");
            }
            PushClientListToUi();
            try { ws.Dispose(); } catch { }
        }
    }

    /// Send "execute" command to a specific WS client
    private async Task SendExecuteToWs(WsClient client, string script)
    {
        if (client.Socket.State != WebSocketState.Open) return;
        var payload = JsonSerializer.Serialize(new { type = "execute", script });
        var bytes = Encoding.UTF8.GetBytes(payload);
        try
        {
            await client.Socket.SendAsync(
                new ArraySegment<byte>(bytes),
                WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch { }
    }

    /// Push updated client list to WebView2 UI
    private void PushClientListToUi()
    {
        var clientsJson = BuildClientsJson();
        Dispatcher.InvokeAsync(async () =>
        {
            try
            {
                await WebView.CoreWebView2.ExecuteScriptAsync(
                    $"typeof window.__onClientsUpdate === 'function' && window.__onClientsUpdate({clientsJson})");
            }
            catch { }
        });
    }

    /// Push a log entry from a Roblox client to the WebView2 console
    private void PushLogToUi(string clientName, int pid, string level, string message)
    {
        var escapedMsg = Esc(message);
        var escapedName = Esc(clientName);
        Dispatcher.InvokeAsync(async () =>
        {
            try
            {
                await WebView.CoreWebView2.ExecuteScriptAsync(
                    $"typeof window.__onRemoteLog === 'function' && window.__onRemoteLog(\"{escapedName}\",{pid},\"{level}\",\"{escapedMsg}\")");
            }
            catch { }
        });
    }

    /// Push LSP data (game tree) from a Roblox client to the WebView2 UI
    private void PushLspToUi(int pid, string rawJson)
    {
        var jsPayload = System.Text.Json.JsonSerializer.Serialize(rawJson);
        Dispatcher.InvokeAsync(async () =>
        {
            try
            {
                await WebView.CoreWebView2.ExecuteScriptAsync(
                    $"typeof window.__onLspData === 'function' && window.__onLspData({pid},{jsPayload})");
            }
            catch { }
        });
    }

    private string BuildClientsJson()
    {
        var sb = new StringBuilder("[");
        bool first = true;
        foreach (var kv in _wsClients)
        {
            if (!first) sb.Append(',');
            first = false;
            var c = kv.Value;
            var avatarUrl = string.IsNullOrEmpty(c.AvatarUrl)
                ? $"https://www.roblox.com/headshot-thumbnail/image?userId={c.UserId}&width=150&height=150&format=png"
                : c.AvatarUrl;
            sb.Append($"{{\"id\":\"{kv.Key}\",\"pid\":{c.Pid},\"userId\":{c.UserId},");
            sb.Append($"\"username\":\"{Esc(c.Username)}\",\"displayName\":\"{Esc(c.DisplayName)}\",");
            sb.Append($"\"placeId\":{c.PlaceId},\"placeName\":\"{Esc(c.PlaceName)}\",");
            sb.Append($"\"jobId\":\"{Esc(c.JobId)}\",\"status\":\"{c.Status}\",");
            sb.Append($"\"avatarUrl\":\"{avatarUrl}\"}}");
        }
        sb.Append(']');
        return sb.ToString();
    }

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    /// Fetch the actual CDN headshot URL from the Roblox thumbnails API
    private static async Task<string> FetchAvatarUrl(long userId)
    {
        try
        {
            var url = $"https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={userId}&size=150x150&format=Png&isCircular=false";
            var json = await _httpClient.GetStringAsync(url);
            var doc = JsonDocument.Parse(json);
            var data = doc.RootElement.GetProperty("data");
            if (data.GetArrayLength() > 0)
            {
                var imageUrl = data[0].GetProperty("imageUrl").GetString();
                if (!string.IsNullOrEmpty(imageUrl)) return imageUrl;
            }
        }
        catch (Exception ex) { Debug.WriteLine($"[Avatar] Failed to fetch for userId {userId}: {ex.Message}"); }
        return "";
    }

    /* ═══════════════════════════════════════════════════════════════════
       Synapse Z API — Execution + Process Detection
       ═══════════════════════════════════════════════════════════════════ */

    private static readonly string SynZPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Synapse Z");

    /// Execute a Lua script via the Synapse Z scheduler (file-based)
    private static int SynzExecute(string script, int pid = 0)
    {
        var schedulerPath = Path.Combine(SynZPath, "bin", "scheduler");
        if (!Directory.Exists(schedulerPath)) return 2;

        var fileName = pid == 0
            ? $"{RandStr(10)}.lua"
            : $"PID{pid}_{RandStr(10)}.lua";
        try
        {
            File.WriteAllText(Path.Combine(schedulerPath, fileName), script + "@@FileFullyWritten@@");
            return 0;
        }
        catch { return 3; }
    }

    /// Check if a Roblox process is a Synapse Z injected instance
    private static bool IsSynz(int pid)
    {
        try
        {
            var process = Process.GetProcessById(pid);
            if (process.HasExited) return false;
            string? path = null;
            try { path = process.MainModule?.FileName; }
            catch { return false; } // ReadProcessMemory can fail on protected processes
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return false;
            using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var buf = new byte[0x600];
            var read = stream.Read(buf, 0, buf.Length);
            if (read < 0x100) return false;
            return Encoding.Default.GetString(buf, 0, read).Contains(".grh");
        }
        catch { return false; }
    }

    private static Process[] GetRobloxProcesses() =>
        Process.GetProcessesByName("RobloxPlayerBeta");

    private static string RandStr(int len)
    {
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        var buf = new char[len];
        for (int i = 0; i < len; i++) buf[i] = chars[_rng.Next(chars.Length)];
        return new string(buf);
    }

    /* ─── Process Polling — detect + auto-inject init script ─── */
    private void PollRobloxProcesses()
    {
        try
        {
            var procs = GetRobloxProcesses();
            var activePids = new HashSet<int>(procs.Select(p => p.Id));

            // Auto-inject init script into new injected instances
            foreach (var proc in procs)
            {
                var pid = proc.Id;
                if (_injectedPids.Contains(pid)) continue;
                if (!IsSynz(pid)) continue;

                _injectedPids.Add(pid);
                var initScript = GetInitScript(pid);
                SynzExecute(initScript, pid);
                Debug.WriteLine($"[Poll] Auto-injected init script to PID {pid}");
            }

            // Clean up injected PIDs that no longer exist
            _injectedPids.RemoveWhere(pid => !activePids.Contains(pid));

            // Remove WS clients whose Roblox process has died
            bool changed = false;
            foreach (var kv in _wsClients)
            {
                if (kv.Value.Pid > 0 && !activePids.Contains(kv.Value.Pid))
                {
                    _wsClients.TryRemove(kv.Key, out var removed);
                    if (removed != null)
                    {
                        try { removed.Socket.Abort(); } catch { }
                        Debug.WriteLine($"[Poll] Removed dead client: {kv.Key} (PID {removed.Pid})");
                        changed = true;
                    }
                }
            }
            if (changed) PushClientListToUi();
        }
        catch (Exception ex) { Debug.WriteLine($"[Poll] Error: {ex.Message}"); }
    }

    /* ─── Ping/Pong heartbeat — detect in-game vs menu ─── */
    private void PingAllClients()
    {
        var pingBytes = Encoding.UTF8.GetBytes("{\"type\":\"ping\"}");
        bool changed = false;

        foreach (var kv in _wsClients)
        {
            var client = kv.Value;

            // Send ping
            if (client.Socket.State == WebSocketState.Open)
            {
                try
                {
                    client.Socket.SendAsync(
                        new ArraySegment<byte>(pingBytes),
                        WebSocketMessageType.Text, true, CancellationToken.None);
                }
                catch { }
            }

            // Check pong timeout (10 seconds)
            var elapsed = (DateTime.UtcNow - client.LastPong).TotalSeconds;
            if (elapsed > 10)
            {
                // No pong — check if PID is still alive
                bool pidAlive = false;
                try { Process.GetProcessById(client.Pid); pidAlive = true; } catch { }

                if (pidAlive)
                {
                    // PID alive but no pong → player is in menu / loading
                    if (client.Status != "menu")
                    {
                        client.Status = "menu";
                        _injectedPids.Remove(client.Pid); // Allow re-injection on rejoin
                        changed = true;
                    }
                }
                else
                {
                    // PID dead → remove client
                    _wsClients.TryRemove(kv.Key, out _);
                    try { client.Socket.Abort(); } catch { }
                    Debug.WriteLine($"[Ping] Removed dead client: {kv.Key}");
                    changed = true;
                }
            }
        }

        if (changed) PushClientListToUi();
    }

    /// Returns the init Lua script that runs inside each Roblox instance
    private string GetInitScript(int pid)
    {
        // Load from external file so it's easy to edit
        var scriptPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources", "init.lua");
        try
        {
            var script = File.ReadAllText(scriptPath);
            // Replace placeholders with actual values
            return script
                .Replace("{{WS_PORT}}", WsPort.ToString())
                .Replace("{{PID}}", pid.ToString());
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Init] Failed to load init.lua: {ex.Message}");
            // Fallback minimal script
            return $@"
if getgenv().__3itx_initialized then return end
getgenv().__3itx_initialized = true
local ws = WebSocket.connect('ws://localhost:{WsPort}')
local HttpService = game:GetService('HttpService')
local p = game:GetService('Players').LocalPlayer
ws:Send(HttpService:JSONEncode({{type='hello',pid={pid},userId=p.UserId,username=p.Name,displayName=p.DisplayName,placeId=game.PlaceId,placeName='',jobId=game.JobId}}))
ws.OnMessage:Connect(function(m) local ok,d=pcall(HttpService.JSONDecode,HttpService,m) if ok and d.type=='execute' then local f=loadstring(d.script) if f then task.spawn(f) end end end)
";
        }
    }

    /* ─── Cleanup on close ─── */
    protected override void OnClosed(EventArgs e)
    {
        _wsCts.Cancel();
        _pollTimer?.Dispose();
        _pingTimer?.Dispose();
        try { _wsListener?.Stop(); } catch { }
        foreach (var kv in _wsClients)
        {
            try { kv.Value.Socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "shutdown", CancellationToken.None); }
            catch { }
        }
        base.OnClosed(e);
    }
}