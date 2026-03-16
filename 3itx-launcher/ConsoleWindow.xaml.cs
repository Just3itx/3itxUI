using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace _3itx_launcher;

public partial class ConsoleWindow : Window
{
    private readonly string _serverUrl;
    private bool _isReady;
    private readonly List<string> _pendingLines = new();
    private DispatcherTimer? _readyPoller;

    /// <summary>
    /// Fired when this window is closed so the main window can re-dock the console.
    /// </summary>
    public event Action? ConsoleClosed;

    public ConsoleWindow(string serverUrl)
    {
        InitializeComponent();
        _serverUrl = serverUrl;
        WindowResizeHelper.EnableResize(this);

        Loaded += async (_, _) =>
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(
                    userDataFolder: Path.Combine(Path.GetTempPath(), "3itx-console-webview"));
                await ConsoleWebView.EnsureCoreWebView2Async(env);

                // Disable cache
                await ConsoleWebView.CoreWebView2.CallDevToolsProtocolMethodAsync(
                    "Network.setCacheDisabled", "{\"cacheDisabled\": true}");

                // Handle messages from the popup (dock-back, clear)
                ConsoleWebView.CoreWebView2.WebMessageReceived += (_, args) =>
                {
                    try
                    {
                        var raw = args.WebMessageAsJson;
                        var doc = System.Text.Json.JsonDocument.Parse(raw);
                        var root = doc.RootElement;

                        if (root.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "closeConsole")
                        {
                            Dispatcher.Invoke(Close);
                        }
                        else if (root.TryGetProperty("action", out var actionProp) && actionProp.GetString() == "consoleClear")
                        {
                            Dispatcher.Invoke(() =>
                            {
                                if (Application.Current.MainWindow is MainWindow mainWin)
                                {
                                    mainWin.ClearConsoleFromPopup();
                                }
                            });
                        }
                    }
                    catch { }
                };

                // Navigate to the console page
                ConsoleWebView.CoreWebView2.Navigate($"{_serverUrl}/console");

                // Start polling for React readiness after navigation
                _readyPoller = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
                _readyPoller.Tick += async (_, _) =>
                {
                    try
                    {
                        if (ConsoleWebView?.CoreWebView2 == null) return;
                        var result = await ConsoleWebView.CoreWebView2.ExecuteScriptAsync(
                            "typeof window.__consoleReady !== 'undefined' && window.__consoleReady === true");
                        if (result == "true")
                        {
                            _readyPoller?.Stop();
                            _readyPoller = null;
                            _isReady = true;
                            Debug.WriteLine($"[ConsoleWindow] Ready! Flushing {_pendingLines.Count} pending lines");
                            FlushPendingLines();
                        }
                    }
                    catch { }
                };
                _readyPoller.Start();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ConsoleWindow] WebView2 init error: {ex.Message}");
            }
        };
    }

    private void FlushPendingLines()
    {
        if (_pendingLines.Count == 0) return;
        // Send all pending lines as a batch
        var allJson = "[" + string.Join(",", _pendingLines) + "]";
        _pendingLines.Clear();
        InjectJs($@"
            try {{
                var lines = {allJson};
                if (typeof window.__setConsoleLines === 'function') {{
                    window.__setConsoleLines(lines);
                }}
            }} catch(e) {{ console.error('[ConsoleWindow] flush error:', e); }}
        ");
    }

    /// <summary>
    /// Forward a console line to the popup WebView2.
    /// If not ready yet, queues the line for later delivery.
    /// </summary>
    public void SendConsoleLine(string lineJson)
    {
        Dispatcher.Invoke(() =>
        {
            if (!_isReady)
            {
                _pendingLines.Add(lineJson);
                return;
            }
            InjectJs($@"
                try {{
                    var line = {lineJson};
                    if (typeof window.__addConsoleLine === 'function') {{
                        window.__addConsoleLine(line);
                    }}
                }} catch(e) {{}}
            ");
        });
    }

    /// <summary>
    /// Send all existing lines to the popup.
    /// If not ready yet, queues them.
    /// </summary>
    public void SendAllLines(string linesJson)
    {
        Dispatcher.Invoke(() =>
        {
            if (!_isReady)
            {
                // Parse and add individual lines to the pending queue
                try
                {
                    var doc = System.Text.Json.JsonDocument.Parse(linesJson);
                    foreach (var el in doc.RootElement.EnumerateArray())
                    {
                        _pendingLines.Add(el.GetRawText());
                    }
                }
                catch { }
                return;
            }
            InjectJs($@"
                try {{
                    var lines = {linesJson};
                    if (typeof window.__setConsoleLines === 'function') {{
                        window.__setConsoleLines(lines);
                    }}
                }} catch(e) {{}}
            ");
        });
    }

    /// <summary>
    /// Clear the console in the popup.
    /// </summary>
    public void ClearConsole()
    {
        Dispatcher.Invoke(() =>
        {
            _pendingLines.Clear();
            if (!_isReady) return;
            InjectJs("if (typeof window.__clearConsole === 'function') window.__clearConsole();");
        });
    }

    private async void InjectJs(string js)
    {
        try
        {
            if (ConsoleWebView?.CoreWebView2 == null) return;
            await ConsoleWebView.CoreWebView2.ExecuteScriptAsync(js);
        }
        catch { }
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
        _readyPoller?.Stop();
        ConsoleClosed?.Invoke();
        try { ConsoleWebView.Dispose(); } catch { }
        base.OnClosed(e);
    }
}
