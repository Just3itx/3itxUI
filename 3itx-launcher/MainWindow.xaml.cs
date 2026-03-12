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
    private const string CurrentVersion = "1.0.4";
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
    private NotificationWindow? _activeNotification;
    private readonly ConcurrentDictionary<int, PidOnlyClient> _pidOnlyClients = new();
    private TaskCompletionSource<bool>? _weaoContinueTcs;

    private class PidOnlyClient
    {
        public int Pid { get; set; }
        public DateTime DetectedAt { get; set; } = DateTime.UtcNow;
    }

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
        try
        {
            var logFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "startup.log");
            File.WriteAllText(logFile, $"[{DateTime.Now}] MainWindow_Loaded started\n");

            // Step 1: Check WEAO status + updates
            SetStep(1, "Checking Synapse Z status...");
            try
            {
                var isUpdated = await CheckWeaoStatus();
                if (!isUpdated)
                {
                    // Show warning overlay and wait for user to click Continue
                    _weaoContinueTcs = new TaskCompletionSource<bool>();
                    WeaoOverlay.Visibility = Visibility.Visible;
                    await _weaoContinueTcs.Task;
                    WeaoOverlay.Visibility = Visibility.Collapsed;
                }
            }
            catch (Exception ex2) { File.AppendAllText(logFile, $"[{DateTime.Now}] WEAO check error: {ex2.Message}\n"); }

            SetStep(1, "Checking for updates...");
            try { await CheckForUpdates(); }
            catch (Exception ex2) { File.AppendAllText(logFile, $"[{DateTime.Now}] Version check error: {ex2}\n"); }

            // Step 2: Check UI project
            SetStep(2, "Verifying UI project...");
            File.AppendAllText(logFile, $"[{DateTime.Now}] _uiPath = {_uiPath}\n");

            if (!Directory.Exists(_uiPath))
            {
                File.AppendAllText(logFile, $"[{DateTime.Now}] UI not found at {_uiPath}\n");
                MessageBox.Show(
                    $"Could not find 3itx-ui project at:\n{_uiPath}\n\nPlace the 3itx-ui folder next to the launcher.",
                    "3itx UI", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }

            // Step 3: Server
            SetStep(3, "Checking for existing server...");
            if (await IsServerReady())
            {
                File.AppendAllText(logFile, $"[{DateTime.Now}] Server already running\n");
                SetStep(4, "Loading interface...");
                await InitWebView();
                SetStep(5, "Ready!");
                File.AppendAllText(logFile, $"[{DateTime.Now}] Done\n");
                return;
            }

            SetStep(3, "Starting Next.js server...");
            File.AppendAllText(logFile, $"[{DateTime.Now}] Starting server\n");
            StartServer();

            SetStep(3, "Waiting for server...");
            if (!await WaitForServer())
            {
                File.AppendAllText(logFile, $"[{DateTime.Now}] Server failed to start\n");
                MessageBox.Show(
                    "Could not connect to the dev server.\nMake sure npm dependencies are installed:\n\ncd 3itx-ui && npm install",
                    "3itx UI", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            // Step 4: Loading UI
            SetStep(4, "Loading interface...");
            File.AppendAllText(logFile, $"[{DateTime.Now}] Loading WebView\n");
            await InitWebView();

            // Step 5: Ready
            SetStep(5, "Ready!");
            File.AppendAllText(logFile, $"[{DateTime.Now}] Done\n");
        }
        catch (Exception ex)
        {
            var logFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "startup.log");
            File.AppendAllText(logFile, $"[{DateTime.Now}] FATAL: {ex}\n");
            MessageBox.Show($"Startup error:\n{ex.Message}", "3itx UI", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    /* ─── Version Check ─── */
    private async Task CheckForUpdates()
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            var json = await _httpClient.GetStringAsync(VersionCheckUrl, cts.Token);
            using var doc = JsonDocument.Parse(json);
            var remoteVersionStr = doc.RootElement.GetProperty("Version").GetString() ?? "";

            if (!string.IsNullOrEmpty(remoteVersionStr) &&
                Version.TryParse(remoteVersionStr, out var remoteVer) &&
                Version.TryParse(CurrentVersion, out var localVer) &&
                remoteVer > localVer)
            {
                var result = MessageBox.Show(this,
                    $"A new version is available!\n\nCurrent: {CurrentVersion}\nLatest: {remoteVersionStr}\n\nWould you like to update?",
                    "3itx UI — Update Available",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Information);

                if (result == MessageBoxResult.Yes)
                {
                    Process.Start(new ProcessStartInfo(ReleasesUrl) { UseShellExecute = true });
                    Application.Current.Shutdown();
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Version] Check failed: {ex.Message}");
            // Silently continue if version check fails (no internet, timeout, etc.)
        }
    }

    /// Check WEAO status API — returns true if Synapse Z is up-to-date
    private static async Task<bool> CheckWeaoStatus()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            client.DefaultRequestHeaders.UserAgent.Clear();
            client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "WEAO-3PService");

            var response = await client.GetStringAsync("https://weao.xyz/api/status/exploits/WEAO228206d0");
            var doc = JsonDocument.Parse(response);
            if (doc.RootElement.TryGetProperty("updateStatus", out var status))
            {
                var isUpdated = status.GetBoolean();
                Debug.WriteLine($"[WEAO] updateStatus = {isUpdated}");
                return isUpdated;
            }
            return true; // If we can't parse, assume it's fine
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[WEAO] Check failed: {ex.Message}");
            return true; // Network error → don't block the user
        }
    }

    /// User clicked "Continue Anyway" on the WEAO warning overlay
    private void WeaoContinue_Click(object sender, RoutedEventArgs e)
    {
        _weaoContinueTcs?.TrySetResult(true);
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
                                    // Wrap in xpcall so Lua runtime errors are captured and sent to the 3itx console
                                    // The init.lua's sendLog function is used to route errors via the existing WS connection
                                    var wrappedScript = $@"
local __fn, __compErr = loadstring({EscLuaStr(scriptToExec)})
if not __fn then
    if error then error(tostring(__compErr)) end
else
    local __ok, __runErr = xpcall(__fn, function(e) return debug.traceback(e, 2) end)
    if not __ok then
        if error then error(tostring(__runErr)) end
    end
end
";
                                    var execResult = SynapseZAPI.Execute(wrappedScript, targetPid);
                                    if (execResult != 0)
                                    {
                                        var errMsg = SynapseZAPI.GetLatestErrorMessage();
                                        Debug.WriteLine($"[Execute] SynapseZAPI.Execute failed for PID {targetPid}: code={execResult}, error={errMsg}");
                                        // Push error to UI console
                                        PushLogToUi($"PID {targetPid}", targetPid, "error", $"Execute error: {errMsg}");
                                    }
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

                    case "openMonitor":
                    {
                        var capPid = root.TryGetProperty("pid", out var capPidProp) ? capPidProp.GetInt32() : 0;
                        var capUser = root.TryGetProperty("username", out var capUserProp) ? capUserProp.GetString() : "Unknown";
                        if (capPid > 0)
                        {
                            try
                            {
                                string monitorError = null;
                                Dispatcher.Invoke(() =>
                                {
                                    try
                                    {
                                        // Close existing monitor for this PID
                                        if (_monitorWindows.TryGetValue(capPid, out var existing))
                                        {
                                            try { existing.Close(); } catch { }
                                            _monitorWindows.Remove(capPid);
                                        }

                                        Process capProc;
                                        try { capProc = Process.GetProcessById(capPid); }
                                        catch { monitorError = "Process not found"; return; }

                                        var hWnd = capProc.MainWindowHandle;
                                        if (hWnd == IntPtr.Zero)
                                        {
                                            monitorError = "No window handle found";
                                            return;
                                        }

                                        var monWin = new MonitorWindow(capPid, capUser ?? "Unknown", hWnd);
                                        monWin.Closed += (_, _) => _monitorWindows.Remove(capPid);
                                        _monitorWindows[capPid] = monWin;
                                        monWin.Show();
                                    }
                                    catch (Exception uiEx)
                                    {
                                        monitorError = uiEx.Message;
                                    }
                                });
                                result = monitorError == null
                                    ? "{\"ok\":true}"
                                    : System.Text.Json.JsonSerializer.Serialize(new { ok = false, error = monitorError });
                            }
                            catch (Exception ex)
                            {
                                result = System.Text.Json.JsonSerializer.Serialize(new { ok = false, error = ex.Message });
                            }
                        }
                        else
                            result = "{\"ok\":false,\"error\":\"invalid pid\"}";
                        break;
                    }

                    case "setWindowTitle":
                    {
                        var titlePid = root.TryGetProperty("pid", out var titlePidProp) ? titlePidProp.GetInt32() : 0;
                        var newTitle = root.TryGetProperty("title", out var titleProp) ? titleProp.GetString() : "";
                        if (titlePid > 0 && !string.IsNullOrEmpty(newTitle))
                        {
                            try
                            {
                                var titleProc = Process.GetProcessById(titlePid);
                                var titleHwnd = titleProc.MainWindowHandle;
                                if (titleHwnd != IntPtr.Zero)
                                {
                                    SetWindowText(titleHwnd, newTitle);
                                    result = "{\"ok\":true}";
                                }
                                else
                                    result = "{\"ok\":false,\"error\":\"no window handle\"}";
                            }
                            catch (Exception ex)
                            {
                                result = System.Text.Json.JsonSerializer.Serialize(new { ok = false, error = ex.Message });
                            }
                        }
                        else
                            result = "{\"ok\":false,\"error\":\"invalid pid or title\"}";
                        break;
                    }

                    case "showJoinNotification":
                    {
                        var notifDisplayName = root.TryGetProperty("displayName", out var ndnP) ? ndnP.GetString() ?? "" : "";
                        var notifUsername = root.TryGetProperty("username", out var nunP) ? nunP.GetString() ?? "" : "";
                        var notifAvatarUrl = root.TryGetProperty("avatarUrl", out var naP) ? naP.GetString() ?? "" : "";
                        var notifJobId = root.TryGetProperty("jobId", out var njP) ? njP.GetString() ?? "" : "";
                        var notifDuration = root.TryGetProperty("duration", out var ndP) ? ndP.GetInt32() : 5;
                        var notifRobloxPid = root.TryGetProperty("robloxPid", out var nppP) ? nppP.GetInt32() : 0;
                        var notifUserId = root.TryGetProperty("userId", out var nuiP) ? nuiP.GetInt64() : 0;

                        if (notifRobloxPid > 0)
                        {
                            Dispatcher.Invoke(() =>
                            {
                                try
                                {
                                    // Close previous notification to avoid stacking
                                    try { _activeNotification?.Close(); } catch { }
                                    _activeNotification = null;

                                    var notif = new NotificationWindow(
                                        notifDisplayName, notifUsername, notifAvatarUrl,
                                        notifJobId, notifRobloxPid, notifDuration,
                                        notifUserId);
                                    notif.Closed += (_, _) => { if (_activeNotification == notif) _activeNotification = null; };
                                    _activeNotification = notif;
                                    notif.Show();
                                }
                                catch (Exception ex)
                                {
                                    Debug.WriteLine($"[Notif] Error showing notification: {ex.Message}");
                                }
                            });
                        }
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
    private readonly System.Windows.Shapes.Ellipse[] _stepDots = new System.Windows.Shapes.Ellipse[5];
    private readonly System.Windows.Controls.TextBlock[] _stepLabels = new System.Windows.Controls.TextBlock[5];
    private readonly System.Windows.Controls.Border[] _stepLines = new System.Windows.Controls.Border[4];
    private bool _stepsInitialized;

    private void InitStepRefs()
    {
        if (_stepsInitialized) return;
        _stepDots[0] = Step1Dot; _stepDots[1] = Step2Dot; _stepDots[2] = Step3Dot; _stepDots[3] = Step4Dot; _stepDots[4] = Step5Dot;
        _stepLabels[0] = Step1Label; _stepLabels[1] = Step2Label; _stepLabels[2] = Step3Label; _stepLabels[3] = Step4Label; _stepLabels[4] = Step5Label;
        _stepLines[0] = Line12; _stepLines[1] = Line23; _stepLines[2] = Line34; _stepLines[3] = Line45;
        _stepsInitialized = true;
    }

    /// <summary>Set the active step (1-5). Steps before it become completed (green), the active step pulses white.</summary>
    private void SetStep(int step, string statusText)
    {
        Dispatcher.Invoke(() =>
        {
            InitStepRefs();
            StatusText.Text = statusText;

            var completedFill = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#22c55e")!);
            var completedStroke = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#16a34a")!);
            var completedLine = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#22c55e")!);
            var completedLabel = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#86efac")!);
            var activeFill = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#e4e4e7")!);
            var activeStroke = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#ffffff")!);
            var activeLabel = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#e4e4e7")!);
            var inactiveFill = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#2a2a30")!);
            var inactiveStroke = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#3f3f46")!);
            var inactiveLabel = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#52525b")!);
            var inactiveLine = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#2a2a30")!);

            for (int i = 0; i < 5; i++)
            {
                if (i < step - 1)
                {
                    // Completed
                    _stepDots[i].Fill = completedFill;
                    _stepDots[i].Stroke = completedStroke;
                    _stepLabels[i].Foreground = completedLabel;
                }
                else if (i == step - 1)
                {
                    // Active
                    _stepDots[i].Fill = activeFill;
                    _stepDots[i].Stroke = activeStroke;
                    _stepLabels[i].Foreground = activeLabel;
                }
                else
                {
                    // Inactive
                    _stepDots[i].Fill = inactiveFill;
                    _stepDots[i].Stroke = inactiveStroke;
                    _stepLabels[i].Foreground = inactiveLabel;
                }
            }

            for (int i = 0; i < 4; i++)
            {
                _stepLines[i].Background = i < step - 1 ? completedLine : inactiveLine;
            }
        });
    }

    private void UpdateStatus(string text, int pct)
    {
        Dispatcher.Invoke(() => StatusText.Text = text);
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
            sb.Append($"\"avatarUrl\":\"{avatarUrl}\",\"pidOnly\":false}}");
        }
        // Include PID-only fallback clients
        foreach (var kv in _pidOnlyClients)
        {
            if (!first) sb.Append(',');
            first = false;
            sb.Append($"{{\"id\":\"pid_{kv.Key}\",\"pid\":{kv.Key},\"userId\":0,");
            sb.Append($"\"username\":\"PID {kv.Key}\",\"displayName\":\"Roblox Instance\",");
            sb.Append($"\"placeId\":0,\"placeName\":\"\",");
            sb.Append($"\"jobId\":\"\",\"status\":\"connected\",");
            sb.Append($"\"avatarUrl\":\"\",\"pidOnly\":true}}");
        }
        sb.Append(']');
        return sb.ToString();
    }

    private static string Esc(string s) => s
        .Replace("\\", "\\\\")
        .Replace("\"", "\\\"")
        .Replace("\n", "\\n")
        .Replace("\r", "\\r")
        .Replace("\t", "\\t")
        .Replace("'", "\\'")
        .Replace("\0", "");

    /// Escape a string for use as a Lua long-string literal [=====[...]=====]
    private static string EscLuaStr(string script)
    {
        // Find a bracket level that doesn't appear in the script
        var level = 0;
        while (script.Contains("]" + new string('=', level) + "]"))
            level++;
        var sep = new string('=', level);
        return $"[{sep}[{script}]{sep}]";
    }

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

    // SynzExecute and IsSynz are now in SynapseZAPI.cs
    // Kept as thin wrappers for backward compat within MainWindow
    private static int SynzExecute(string script, int pid = 0) => SynapseZAPI.Execute(script, pid);
    private static bool IsSynz(int pid) => SynapseZAPI.IsSynz(pid);
    private static Process[] GetRobloxProcesses() => SynapseZAPI.GetRobloxProcesses();

    /* ─── Process Polling — detect + auto-inject init script ─── */
    private void PollRobloxProcesses()
    {
        try
        {
            var procs = GetRobloxProcesses();
            var activePids = new HashSet<int>(procs.Select(p => p.Id));
            var wsConnectedPids = new HashSet<int>(_wsClients.Values.Select(c => c.Pid));

            // Auto-inject init script into new injected instances
            foreach (var proc in procs)
            {
                var pid = proc.Id;
                if (_injectedPids.Contains(pid)) continue;
                if (!SynapseZAPI.IsSynz(pid)) continue;

                _injectedPids.Add(pid);
                var initScript = GetInitScript(pid);
                var injectResult = SynapseZAPI.Execute(initScript, pid);
                if (injectResult != 0)
                {
                    var errMsg = SynapseZAPI.GetLatestErrorMessage();
                    Debug.WriteLine($"[Poll] Failed to inject init script to PID {pid}: code={injectResult}, error={errMsg}");
                }
                else
                {
                    Debug.WriteLine($"[Poll] Auto-injected init script to PID {pid}");
                }
            }

            // PID-based fallback: if a SynZ instance has no WS client, track it as PID-only
            bool pidChanged = false;
            foreach (var proc in procs)
            {
                var pid = proc.Id;
                if (wsConnectedPids.Contains(pid)) continue;
                if (!SynapseZAPI.IsSynz(pid)) continue;
                if (!_pidOnlyClients.ContainsKey(pid))
                {
                    _pidOnlyClients[pid] = new PidOnlyClient { Pid = pid };
                    pidChanged = true;
                    Debug.WriteLine($"[Poll] Added PID-only fallback client: {pid}");
                }
            }

            // Remove PID-only clients that now have WS connections or whose process died
            foreach (var kv in _pidOnlyClients)
            {
                if (!activePids.Contains(kv.Key) || wsConnectedPids.Contains(kv.Key))
                {
                    _pidOnlyClients.TryRemove(kv.Key, out _);
                    pidChanged = true;
                }
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
            if (changed || pidChanged) PushClientListToUi();
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

    /* ═══ Win32 Window Capture ═══ */
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    internal static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr GetWindowDC(IntPtr hWnd);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    internal static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern bool SetWindowText(IntPtr hWnd, string lpString);

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    internal struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    private readonly Dictionary<int, MonitorWindow> _monitorWindows = new();

    private static string? CaptureWindowBase64(IntPtr hWnd)
    {
        try
        {
            if (!GetWindowRect(hWnd, out var rect)) return null;
            int w = rect.Right - rect.Left;
            int h = rect.Bottom - rect.Top;
            if (w <= 0 || h <= 0) return null;

            using var bmp = new System.Drawing.Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format24bppRgb);
            using var gfx = System.Drawing.Graphics.FromImage(bmp);
            var hdc = gfx.GetHdc();
            PrintWindow(hWnd, hdc, 2); // PW_RENDERFULLCONTENT = 2
            gfx.ReleaseHdc(hdc);

            // Encode as JPEG at 50% quality for smaller payload
            using var ms = new System.IO.MemoryStream();
            var jpegCodec = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders()
                .First(c => c.MimeType == "image/jpeg");
            var encoderParams = new System.Drawing.Imaging.EncoderParameters(1);
            encoderParams.Param[0] = new System.Drawing.Imaging.EncoderParameter(
                System.Drawing.Imaging.Encoder.Quality, 50L);
            bmp.Save(ms, jpegCodec, encoderParams);

            var b64 = Convert.ToBase64String(ms.ToArray());
            return $"data:image/jpeg;base64,{b64}";
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Capture] Error: {ex.Message}");
            return null;
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