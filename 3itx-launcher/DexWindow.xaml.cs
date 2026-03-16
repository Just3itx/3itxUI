using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;

namespace _3itx_launcher;

public partial class DexWindow : Window
{
    private readonly int _pid;
    private readonly string _dataPath;
    private DexContextMenuWindow? _activeContextMenu;
    private ScriptViewerWindow? _scriptViewer;

    /// <summary>
    /// Intercept DEX data from Roblox — route decompile/dump results to ScriptViewerWindow.
    /// Returns true if handled (should NOT be forwarded to WebView), false otherwise.
    /// </summary>
    public bool HandleDexData(string rawJson)
    {
        try
        {
            if (rawJson.Contains("dex_decompileResult"))
            {
                var doc = System.Text.Json.JsonDocument.Parse(rawJson);
                var r = doc.RootElement;
                var source = r.TryGetProperty("source", out var sp) ? sp.GetString() ?? "" : "";
                var scriptName = r.TryGetProperty("scriptName", out var snp) ? snp.GetString() ?? "" : "";
                var fullName = r.TryGetProperty("fullName", out var fnp) ? fnp.GetString() ?? "" : "";
                var success = r.TryGetProperty("success", out var scp) && scp.GetBoolean();
                _scriptViewer?.OnDecompileResult(source, scriptName, fullName, success);
                return true;
            }
            if (rawJson.Contains("dex_dumpFunctionsResult"))
            {
                var doc = System.Text.Json.JsonDocument.Parse(rawJson);
                var r = doc.RootElement;
                var dump = r.TryGetProperty("dump", out var dp) ? dp.GetString() ?? "" : "";
                var success = r.TryGetProperty("success", out var scp) && scp.GetBoolean();
                _scriptViewer?.OnDumpResult(dump, success);
                return true;
            }
        }
        catch { }
        return false;
    }

    private void OpenScriptViewer(string treePath, string scriptName)
    {
        if (_scriptViewer == null || !_scriptViewer.IsLoaded)
        {
            _scriptViewer = new ScriptViewerWindow(_pid, _dataPath);
            _scriptViewer.RelayDexRequest = (pid, type, path, requestId) =>
            {
                // Relay decompile/dump request to Roblox via MainWindow
                if (Application.Current.MainWindow is MainWindow mainWin)
                {
                    mainWin.RelayDexMessage(pid, $"{{\"type\":\"{type}\",\"path\":\"{path.Replace("\\", "\\\\")}\",\"requestId\":\"{requestId}\"}}");
                }
            };
            _scriptViewer.InsertToEditorCallback = (name, content) =>
            {
                // Insert to main editor via MainWindow's WebView
                if (Application.Current.MainWindow is MainWindow mainWin)
                {
                    mainWin.InsertToEditor(name, content);
                }
            };
            _scriptViewer.Closed += (_, _) => _scriptViewer = null;
            _scriptViewer.Show();
        }
        else
        {
            _scriptViewer.Show();
            _scriptViewer.Activate();
        }
        _scriptViewer.LoadScript(treePath, scriptName);
    }

    /// <summary>
    /// Instantly notify the DEX UI that the client disconnected (went to menu / left game).
    /// </summary>
    public void NotifyDisconnected()
    {
        Dispatcher.InvokeAsync(async () =>
        {
            try
            {
                if (DexWebView?.CoreWebView2 != null)
                    await DexWebView.CoreWebView2.ExecuteScriptAsync(
                        "typeof window.__onDexConnectionStatus === 'function' && window.__onDexConnectionStatus(false)");
            }
            catch { }
        });
    }

    /// <summary>
    /// Instantly notify the DEX UI that the client reconnected (joined a game).
    /// </summary>
    public void NotifyReconnected()
    {
        Dispatcher.InvokeAsync(async () =>
        {
            try
            {
                if (DexWebView?.CoreWebView2 != null)
                    await DexWebView.CoreWebView2.ExecuteScriptAsync(
                        "typeof window.__onDexConnectionStatus === 'function' && window.__onDexConnectionStatus(true)");
            }
            catch { }
        });
    }

    public DexWindow(int pid, string username, string serverUrl, string dataPath)
    {
        InitializeComponent();
        _pid = pid;
        _dataPath = dataPath;
        TitleText.Text = $"{username}'s Explorer";
        WindowResizeHelper.EnableResize(this);
        Loaded += async (_, _) =>
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(
                    userDataFolder: Path.Combine(Path.GetTempPath(), "3itx-dex-webview"));
                await DexWebView.EnsureCoreWebView2Async(env);

                // Disable Default Context Menu
                DexWebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;

                // Disable cache so the latest JS from the dev server is always loaded
                await DexWebView.CoreWebView2.CallDevToolsProtocolMethodAsync(
                    "Network.setCacheDisabled", "{\"cacheDisabled\": true}");

                // Handle bridge messages from the DEX UI (same pattern as MainWindow)
                DexWebView.CoreWebView2.WebMessageReceived += async (_, args) =>
                {
                    try
                    {
                        var rawJson = args.WebMessageAsJson;
                        var doc = JsonDocument.Parse(rawJson);
                        var root = doc.RootElement;

                        // Handle close message
                        if (root.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "closeDex")
                        {
                            Dispatcher.Invoke(Close);
                            return;
                        }

                        if (!root.TryGetProperty("action", out var actionProp)) return;
                        var action = actionProp.GetString();
                        var requestId = root.TryGetProperty("requestId", out var rid) ? rid.GetString() ?? "" : "";

                        string result = "{}";

                        switch (action)
                        {
                            case "ensureDexIcons":
                            {
                                var dexIconsDir = Path.Combine(_dataPath, "DexIcons");
                                if (Directory.Exists(dexIconsDir) &&
                                    Directory.GetFiles(dexIconsDir, "*.png", SearchOption.AllDirectories).Length > 0)
                                {
                                    result = "{\"ok\":true,\"alreadyExists\":true}";
                                }
                                else
                                {
                                    try
                                    {
                                        var exeDir = AppDomain.CurrentDomain.BaseDirectory;
                                        var localZip = Path.Combine(exeDir, "Resources", "ExplorerIcons.zip");
                                        if (!File.Exists(localZip))
                                        {
                                            result = JsonSerializer.Serialize(new { ok = false, error = "ExplorerIcons.zip not found in Resources" });
                                            break;
                                        }
                                        if (Directory.Exists(dexIconsDir)) Directory.Delete(dexIconsDir, true);
                                        ZipFile.ExtractToDirectory(localZip, dexIconsDir);
                                        result = "{\"ok\":true}";
                                    }
                                    catch (Exception ex)
                                    {
                                        result = JsonSerializer.Serialize(new { ok = false, error = ex.Message });
                                    }
                                }
                                break;
                            }

                            case "getDexIcons":
                            {
                                var iconsDir = Path.Combine(_dataPath, "DexIcons");
                                if (!Directory.Exists(iconsDir))
                                {
                                    result = "{\"ok\":false,\"error\":\"DexIcons folder not found\"}";
                                }
                                else
                                {
                                    var icons = new Dictionary<string, string>();
                                    foreach (var file in Directory.GetFiles(iconsDir, "*.png", SearchOption.AllDirectories))
                                    {
                                        var className = Path.GetFileNameWithoutExtension(file);
                                        var b64 = Convert.ToBase64String(File.ReadAllBytes(file));
                                        icons[className] = $"data:image/png;base64,{b64}";
                                    }
                                    result = JsonSerializer.Serialize(new { ok = true, icons });
                                }
                                break;
                            }

                            case "sendDexMessage":
                            {
                                var mainWin = Application.Current.MainWindow as MainWindow;
                                if (mainWin != null)
                                {
                                    var dexPid = root.TryGetProperty("pid", out var pidP) ? pidP.GetInt32() : 0;
                                    var dexMsg = root.TryGetProperty("message", out var msgP) ? msgP.GetRawText() : "{}";
                                    result = await mainWin.SendDexMessageAsync(dexPid, dexMsg);
                                }
                                else
                                {
                                    result = "{\"ok\":false,\"error\":\"MainWindow not found\"}";
                                }
                                break;
                            }

                            case "executeOnClients":
                            {
                                var mainWin = Application.Current.MainWindow as MainWindow;
                                if (mainWin != null)
                                {
                                    var script = root.TryGetProperty("script", out var scP) ? scP.GetString() ?? "" : "";
                                    var method = root.TryGetProperty("method", out var mtP) ? mtP.GetString() ?? "scheduler" : "scheduler";
                                    var pids = new List<int>();
                                    if (root.TryGetProperty("pids", out var pidsArr) && pidsArr.ValueKind == JsonValueKind.Array)
                                    {
                                        foreach (var p in pidsArr.EnumerateArray())
                                            pids.Add(p.GetInt32());
                                    }
                                    mainWin.ExecuteOnClients(pids.ToArray(), script, method);
                                    result = "{\"ok\":true}";
                                }
                                else
                                {
                                    result = "{\"ok\":false,\"error\":\"MainWindow not found\"}";
                                }
                                break;
                            }

                            case "closeDexContextMenu":
                            {
                                await Dispatcher.InvokeAsync(() =>
                                {
                                    _activeContextMenu?.Close();
                                    _activeContextMenu = null;
                                });
                                result = "{\"ok\":true}";
                                break;
                            }

                            case "dexDoubleClick":
                            {
                                var dblPath = root.TryGetProperty("treePath", out var dblP) ? dblP.GetString() ?? "" : "";
                                var dblName = root.TryGetProperty("name", out var dblN) ? dblN.GetString() ?? "" : "";
                                var dblClass = root.TryGetProperty("className", out var dblC) ? dblC.GetString() ?? "" : "";
                                if (dblClass is "LocalScript" or "ModuleScript" or "Script")
                                {
                                    await Dispatcher.InvokeAsync(() => OpenScriptViewer(dblPath, dblName));
                                }
                                result = "{\"ok\":true}";
                                break;
                            }

                            case "showDexContextMenu":
                            {
                                var clientX = root.TryGetProperty("x", out var xP) ? xP.GetDouble() : 0;
                                var clientY = root.TryGetProperty("y", out var yP) ? yP.GetDouble() : 0;
                                var path = root.TryGetProperty("path", out var pathP) ? pathP.GetString() ?? "" : "";
                                var treePath = root.TryGetProperty("treePath", out var treePathP) ? treePathP.GetString() ?? path : path;
                                var name = root.TryGetProperty("name", out var nameP) ? nameP.GetString() ?? "" : "";
                                var instanceClass = root.TryGetProperty("className", out var classP) ? classP.GetString() ?? "" : "";
                                var isRoot = root.TryGetProperty("isRoot", out var isRootP) && isRootP.GetBoolean();
                                var isSearchResult = root.TryGetProperty("isSearchResult", out var isSearchP) && isSearchP.GetBoolean();

                                await Dispatcher.InvokeAsync(() =>
                                {
                                    // Convert WebView2 client coords to screen coords
                                    var dpiScale = VisualTreeHelper.GetDpi(this);
                                    var webViewPos = DexWebView.PointToScreen(new Point(0, 0));
                                    var screenX = webViewPos.X + (clientX * dpiScale.DpiScaleX);
                                    var screenY = webViewPos.Y + (clientY * dpiScale.DpiScaleY);

                                    var hasCopied = root.TryGetProperty("hasCopied", out var hcP) && hcP.GetBoolean();

                                    // Build menu items
                                    var items = new List<ContextMenuItemData>();
                                    var isNilRoot = treePath == "nil";
                                    var isNilDescendant = treePath.StartsWith("nil.");

                                    if (isNilRoot)
                                    {
                                        // Nil Instances root folder — only Refresh, Hide, Expand/Collapse
                                        items.Add(new ContextMenuItemData { Label = "Refresh Nil Instances", ActionId = "refreshNil", Icon = "\uE72C" });
                                        items.Add(new ContextMenuItemData { Label = "Hide Nil Instances", ActionId = "hideNil", Icon = "\uED1A" });
                                        items.Add(new ContextMenuItemData { Separator = true });
                                        items.Add(new ContextMenuItemData { Label = "Select Children", ActionId = "selectChildren", Icon = "\uE8B3" });
                                        items.Add(new ContextMenuItemData { Label = "Expand All", ActionId = "expandAll", Icon = "\uE972" });
                                        items.Add(new ContextMenuItemData { Label = "Collapse All", ActionId = "collapseAll", Icon = "\uE971" });
                                    }
                                    else if (isNilDescendant)
                                    {
                                        // Nil instance descendants — Copy Path, View Script, Select Children, Expand/Collapse, Delete
                                        items.Add(new ContextMenuItemData { Label = "Copy Path", ActionId = "copyPath", Icon = "\uE8C8" });
                                        if (instanceClass is "LocalScript" or "ModuleScript" or "Script")
                                            items.Add(new ContextMenuItemData { Label = "Decompile", ActionId = "viewScript", Icon = "\uE943" });
                                        items.Add(new ContextMenuItemData { Separator = true });
                                        items.Add(new ContextMenuItemData { Label = "Select Children", ActionId = "selectChildren", Icon = "\uE8B3" });
                                        items.Add(new ContextMenuItemData { Label = "Expand All", ActionId = "expandAll", Icon = "\uE972" });
                                        items.Add(new ContextMenuItemData { Label = "Collapse All", ActionId = "collapseAll", Icon = "\uE971" });
                                        items.Add(new ContextMenuItemData { Separator = true });
                                        items.Add(new ContextMenuItemData { Label = "Delete", ActionId = "delete", Danger = true, Icon = "\uE74D", Shortcut = "Del" });
                                    }
                                    else
                                    {
                                        // Normal game items
                                        items.Add(new ContextMenuItemData { Label = "Copy Path", ActionId = "copyPath", Icon = "\uE8C8" });

                                        if (!isRoot)
                                        {
                                            items.Add(new ContextMenuItemData { Label = "Jump to Parent", ActionId = "jumpToParent", Icon = "\uE74A" });
                                            items.Add(new ContextMenuItemData { Label = "Rename", ActionId = "rename", Icon = "\uE8AC", Shortcut = "F2" });
                                        }

                                        if (isSearchResult)
                                        {
                                            items.Add(new ContextMenuItemData { Label = "Clear Search & Jump To", ActionId = "clearSearchJumpTo", Icon = "\uE773" });
                                        }

                                        // Only show Teleport To for items under Workspace
                                        if (treePath.StartsWith("game.Workspace.") || treePath == "game.Workspace")
                                        {
                                            items.Add(new ContextMenuItemData { Label = "Teleport To", ActionId = "teleportTo", Icon = "\uE81D" });
                                        }

                                        // View Script for Script/LocalScript/ModuleScript
                                        if (instanceClass is "LocalScript" or "ModuleScript" or "Script")
                                            items.Add(new ContextMenuItemData { Label = "View Script", ActionId = "viewScript", Icon = "\uE943" });

                                        items.Add(new ContextMenuItemData { Separator = true });
                                        items.Add(new ContextMenuItemData { Label = "Select Children", ActionId = "selectChildren", Icon = "\uE8B3" });
                                        items.Add(new ContextMenuItemData { Label = "Expand All", ActionId = "expandAll", Icon = "\uE972" });
                                        items.Add(new ContextMenuItemData { Label = "Collapse All", ActionId = "collapseAll", Icon = "\uE971" });

                                        if (!isRoot)
                                        {
                                            items.Add(new ContextMenuItemData { Separator = true });
                                            items.Add(new ContextMenuItemData { Label = "Copy", ActionId = "copy", Icon = "\uE8C8", Shortcut = "Ctrl+C" });
                                            items.Add(new ContextMenuItemData { Label = "Cut", ActionId = "cut", Icon = "\uE8C6", Shortcut = "Ctrl+X" });
                                        }
                                        items.Add(new ContextMenuItemData { Label = "Paste Into", ActionId = "pasteInto", Icon = "\uE77F", Shortcut = "Ctrl+Shift+V", Disabled = !hasCopied });

                                        if (!isRoot)
                                            items.Add(new ContextMenuItemData { Label = "Duplicate", ActionId = "duplicate", Icon = "\uE8C8", Shortcut = "Ctrl+D" });

                                        items.Add(new ContextMenuItemData { Separator = true });
                                        items.Add(new ContextMenuItemData
                                        {
                                            Label = "Insert Object",
                                            ActionId = "insertObject",
                                            Icon = "\uE710",
                                            SubItems = new List<ContextMenuItemData>() // Marker for submenu
                                        });

                                        if (!isRoot)
                                        {
                                            items.Add(new ContextMenuItemData { Separator = true });
                                            items.Add(new ContextMenuItemData { Label = "Delete", ActionId = "delete", Danger = true, Icon = "\uE74D", Shortcut = "Del" });
                                        }
                                    }

                                    // Close any existing context menu first
                                    _activeContextMenu?.Close();
                                    _activeContextMenu = null;

                                    var popup = new DexContextMenuWindow(
                                        screenX / dpiScale.DpiScaleX,
                                        screenY / dpiScale.DpiScaleY,
                                        items,
                                        (actionId, menuClassName) =>
                                        {
                                            // Handle viewScript directly in C#
                                            if (actionId == "viewScript")
                                            {
                                                Dispatcher.InvokeAsync(() => OpenScriptViewer(treePath, name));
                                                return;
                                            }

                                            // Send action back to WebView2
                                            var actionJson = JsonSerializer.Serialize(new
                                            {
                                                type = "contextMenuAction",
                                                action = actionId,
                                                path = path,
                                                treePath = treePath,
                                                name = name,
                                                className = menuClassName ?? ""
                                            });

                                            // For clearSearchJumpTo and jumpToParent, clear search first via direct DOM manipulation
                                            // then dispatch the action, because WebView2 may cache old JS where these cases don't exist
                                            if (actionId == "clearSearchJumpTo" || actionId == "jumpToParent")
                                            {
                                                // Use treePath (DOM path) for navigation — it matches [data-path] attributes directly
                                                // No need for GetService/GetChildren normalization since treePath is already the DOM path
                                                var navTreePath = root.TryGetProperty("treePath", out var tp) ? tp.GetString() ?? path : path;
                                                
                                                // Compute target path for jump
                                                var targetPath = actionId == "jumpToParent"
                                                    ? string.Join(".", navTreePath.Split('.').SkipLast(1))
                                                    : navTreePath;
                                                
                                                if (!string.IsNullOrEmpty(targetPath))
                                                {
                                                    Dispatcher.InvokeAsync(async () =>
                                                    {
                                                        var logFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "jumpto_log.txt");
                                                        void Log(string msg) { try { File.AppendAllText(logFile, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}\n"); } catch { } }
                                                        try
                                                        {
                                                            Log($"=== JumpTo started: action={actionId}, target={targetPath} ===");
                                                            
                                                            // Step 1: Only clear search if there's an active search
                                                            var hasSearch = await DexWebView.CoreWebView2.ExecuteScriptAsync(@"
                                                                (function() {
                                                                    var input = document.querySelector('input[placeholder=""Filter Workspace""]');
                                                                    return input && input.value.length > 0 ? 'yes' : 'no';
                                                                })();
                                                            ");
                                                            Log($"Step 1: hasSearch={hasSearch}");
                                                            
                                                            if (hasSearch == "\"yes\"")
                                                            {
                                                                await DexWebView.CoreWebView2.ExecuteScriptAsync(@"
                                                                    (function() {
                                                                        var input = document.querySelector('input[placeholder=""Filter Workspace""]');
                                                                        if (input) {
                                                                            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                                                                            nativeInputValueSetter.call(input, '');
                                                                            input.dispatchEvent(new Event('input', { bubbles: true }));
                                                                        }
                                                                    })();
                                                                ");
                                                                Log("Step 1: Search cleared, waiting for re-render");
                                                                await Task.Delay(500);
                                                            }

                                                            // Step 2: Expand each ancestor — but SKIP if already expanded
                                                            var segments = targetPath.Split('.');
                                                            for (int i = 2; i < segments.Length; i++)
                                                            {
                                                                var ancestorPath = string.Join(".", segments.Take(i));
                                                                var nextChildPath = string.Join(".", segments.Take(i + 1));
                                                                var escapedPath = ancestorPath.Replace("\\", "\\\\").Replace("\"", "\\\"");
                                                                var escapedNextPath = nextChildPath.Replace("\\", "\\\\").Replace("\"", "\\\"");

                                                                // First check if the next child already exists in the DOM
                                                                var alreadyExists = await DexWebView.CoreWebView2.ExecuteScriptAsync(
                                                                    $@"!!document.querySelector('[data-path=""{escapedNextPath}""]')");
                                                                
                                                                if (alreadyExists == "true")
                                                                {
                                                                    Log($"Step 2[{i}]: {ancestorPath} already expanded (child {nextChildPath} exists)");
                                                                    continue; // Skip — already expanded
                                                                }

                                                                Log($"Step 2[{i}]: Expanding {ancestorPath}");

                                                                var expandJs = $@"
                                                                    (function() {{
                                                                        var row = document.querySelector('[data-path=""{escapedPath}""]');
                                                                        if (row) {{
                                                                            var expandBtn = row.querySelector('button');
                                                                            if (expandBtn) {{
                                                                                expandBtn.click();
                                                                                return 'expanded';
                                                                            }}
                                                                            return 'no-expand-btn';
                                                                        }}
                                                                        return 'not-found';
                                                                    }})();
                                                                ";
                                                                
                                                                var result = await DexWebView.CoreWebView2.ExecuteScriptAsync(expandJs);
                                                                Log($"Step 2[{i}]: Result: {result}");

                                                                // Poll for the next child to appear (up to 3 seconds)
                                                                var pollJs = $@"!!document.querySelector('[data-path=""{escapedNextPath}""]')";
                                                                bool childFound = false;
                                                                for (int attempt = 0; attempt < 30; attempt++)
                                                                {
                                                                    await Task.Delay(100);
                                                                    var found = await DexWebView.CoreWebView2.ExecuteScriptAsync(pollJs);
                                                                    if (found == "true")
                                                                    {
                                                                        Log($"Step 2[{i}]: Child appeared after {(attempt + 1) * 100}ms");
                                                                        childFound = true;
                                                                        break;
                                                                    }
                                                                }
                                                                if (!childFound) Log($"Step 2[{i}]: Child NOT found after 3s timeout!");
                                                            }

                                                            // Step 4: Select the target node and scroll to it
                                                            var targetEscaped = targetPath.Replace("\\", "\\\\").Replace("'", "\\'");
                                                            await DexWebView.CoreWebView2.ExecuteScriptAsync($@"
                                                                (function() {{
                                                                    var target = document.querySelector('[data-path=""{targetEscaped}""]');
                                                                    if (target) {{
                                                                        target.click();
                                                                        setTimeout(function() {{
                                                                            target.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
                                                                        }}, 100);
                                                                    }}
                                                                }})();
                                                            ");
                                                            Log("Step 4: Target selected and scrolled");
                                                        }
                                                        catch (Exception ex)
                                                        {
                                                            Debug.WriteLine($"[JumpTo] Error: {ex.Message}");
                                                        }
                                                    });
                                                }
                                            }
                                            else
                                            {
                                                var js = $@"
                                                    if (typeof window.__dexContextMenuAction === 'function') {{
                                                        window.__dexContextMenuAction({actionJson});
                                                    }}
                                                ";
                                                Dispatcher.InvokeAsync(async () =>
                                                {
                                                    try { await DexWebView.CoreWebView2.ExecuteScriptAsync(js); }
                                                    catch { }
                                                });
                                            }
                                        },
                                        _dataPath);

                                    popup.Closed += (_, _) =>
                                    {
                                        if (_activeContextMenu == popup)
                                            _activeContextMenu = null;
                                    };

                                    _activeContextMenu = popup;
                                    popup.Show();
                                });

                                result = "{\"ok\":true}";
                                break;
                            }
                        }

                        // Send response using same pattern as MainWindow:
                        // Push {requestId, data} onto __bridgeQueue, then call __bridgeDrain()
                        var response = $"{{\"requestId\":\"{requestId}\",\"data\":{result}}}";
                        var jsPayload = JsonSerializer.Serialize(response);
                        var jsCode = $@"
                            try {{
                                var resp = JSON.parse({jsPayload});
                                (window.__bridgeQueue = window.__bridgeQueue || []).push(resp);
                                if (typeof window.__bridgeDrain === 'function') {{
                                    window.__bridgeDrain();
                                }}
                            }} catch(e) {{
                                console.error('[DexBridge] Error:', e.message);
                            }}
                        ";
                        await Dispatcher.InvokeAsync(async () =>
                        {
                            try { await DexWebView.CoreWebView2.ExecuteScriptAsync(jsCode); }
                            catch { }
                        });
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"[DexWindow] Message error: {ex.Message}");
                    }
                };

                // Initialize bridge queue on navigation complete
                DexWebView.CoreWebView2.NavigationCompleted += async (_, navArgs) =>
                {
                    if (navArgs.IsSuccess)
                    {
                        await DexWebView.CoreWebView2.ExecuteScriptAsync(
                            "window.__bridgeQueue = window.__bridgeQueue || [];");
                    }
                };

                // Close context menu when WebView2 regains focus (user clicked in the page)
                DexWebView.GotFocus += (_, _) =>
                {
                    _activeContextMenu?.Close();
                    _activeContextMenu = null;
                };

                // Navigate to the DEX page
                var encodedUser = Uri.EscapeDataString(username);
                DexWebView.CoreWebView2.Navigate($"{serverUrl}/dex?pid={pid}&username={encodedUser}");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[DexWindow] WebView2 init error: {ex.Message}");
            }
        };
    }

    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        else
            DragMove();
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosed(EventArgs e)
    {
        try { DexWebView.Dispose(); } catch { }
        base.OnClosed(e);
    }
}
