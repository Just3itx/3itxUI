using System;
using System.IO;
using System.Net;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;

namespace _3itx_launcher;

public partial class ScriptViewerWindow : Window
{
    private readonly int _pid;
    private readonly string _dataPath;
    private string _scriptPath = "";
    private string _scriptName = "";
    private string _currentSource = "";
    private bool _webViewReady;
    private string? _pendingSource;  // Buffered source for when WebView isn't ready yet

    /// <summary>
    /// Callback to relay dex requests to the Roblox client (set by DexWindow).
    /// </summary>
    public Action<int, string, string, string>? RelayDexRequest { get; set; }

    /// <summary>
    /// Callback to insert code into the main editor tab (set by DexWindow).
    /// </summary>
    public Action<string, string>? InsertToEditorCallback { get; set; }

    public ScriptViewerWindow(int pid, string dataPath)
    {
        InitializeComponent();
        _pid = pid;
        _dataPath = dataPath;
        InitWebViewAsync();
        WindowResizeHelper.EnableResize(this);
    }

    private async void InitWebViewAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(
                userDataFolder: Path.Combine(Path.GetTempPath(), "3itx-scriptviewer-webview"));
            await CodeWebView.EnsureCoreWebView2Async(env);

            var settings = CodeWebView.CoreWebView2.Settings;
            settings.AreDevToolsEnabled = false;
            settings.IsStatusBarEnabled = false;
            settings.AreDefaultContextMenusEnabled = false;

            CodeWebView.CoreWebView2.NavigationCompleted += async (_, _) =>
            {
                _webViewReady = true;
                // If a decompile result arrived before the WebView was ready, display it now
                if (_pendingSource != null)
                {
                    var src = _pendingSource;
                    _pendingSource = null;
                    var escaped = JsonSerializer.Serialize(src);
                    await CodeWebView.CoreWebView2.ExecuteScriptAsync($"setCode({escaped})");
                }
            };

            CodeWebView.CoreWebView2.NavigateToString(BuildHtml());
        }
        catch { }
    }

    private static string BuildHtml()
    {
        return @"<!DOCTYPE html>
<html>
<head>
<meta charset=""utf-8"">
<link rel=""preconnect"" href=""https://fonts.googleapis.com"">
<link rel=""preconnect"" href=""https://fonts.gstatic.com"" crossorigin>
<link href=""https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"" rel=""stylesheet"">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
    background: #09090b;
    color: #d4d4d8;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;
    overflow: hidden;
}
#container {
    display: flex;
    height: 100vh;
    overflow: auto;
}
#container::-webkit-scrollbar { width:6px; height:6px; }
#container::-webkit-scrollbar-track { background:transparent; }
#container::-webkit-scrollbar-thumb { background:#27272a; border-radius:3px; }
#container::-webkit-scrollbar-thumb:hover { background:#3f3f46; }
#container::-webkit-scrollbar-corner { background:transparent; }

#lines {
    position: sticky;
    left: 0;
    flex-shrink: 0;
    padding: 12px 0;
    text-align: right;
    color: #3f3f46;
    user-select: none;
    background: #09090b;
    z-index: 1;
    border-right: 1px solid #18181b;
    min-width: 38px;
    font-variant-numeric: tabular-nums;
}
#lines span { display:block; padding:0 10px 0 8px; }

#code {
    flex: 1;
    padding: 12px 14px;
    white-space: pre;
    tab-size: 4;
    overflow: visible;
}

.kw { color:#c084fc; }
.str { color:#86efac; }
.num { color:#fbbf24; }
.cmt { color:#52525b; font-style:italic; }
.fn { color:#60a5fa; }
.bool { color:#f97316; }
.self { color:#fb923c; }
.global { color:#38bdf8; }
</style>
</head>
<body>
<div id=""container"">
    <div id=""lines""></div>
    <code id=""code""></code>
</div>
<script>
function setCode(src) {
    var code = document.getElementById('code');
    var lines = document.getElementById('lines');
    code.innerHTML = highlight(src);
    var lineCount = src.split('\n').length;
    var lineHtml = '';
    for (var i = 1; i <= lineCount; i++) lineHtml += '<span>' + i + '</span>';
    lines.innerHTML = lineHtml;
}

function appendCode(src) {
    var code = document.getElementById('code');
    var existing = code.textContent || '';
    setCode(existing + src);
}

function getCode() {
    return document.getElementById('code').textContent || '';
}

// Token-based highlighting: collect tokens first, then render.
// This prevents regex cross-contamination (e.g. string regex matching
// inside previously-inserted span class attributes).
function highlight(src) {
    // Escape HTML first
    src = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    var tokens = []; // { start, end, cls }
    var used = new Uint8Array(src.length); // track which chars are already tokenized

    function markToken(regex, cls) {
        var m;
        regex.lastIndex = 0;
        while ((m = regex.exec(src)) !== null) {
            var s = m.index, e = s + m[0].length;
            // Check no overlap with existing tokens
            var overlap = false;
            for (var i = s; i < e; i++) { if (used[i]) { overlap = true; break; } }
            if (!overlap) {
                tokens.push({ s: s, e: e, cls: cls });
                for (var i = s; i < e; i++) used[i] = 1;
            }
        }
    }

    // Order matters: comments first, then strings, then others
    // Multi-line comments --[[ ]]
    markToken(/--\[\[[\s\S]*?\]\]/g, 'cmt');
    // Single-line comments (not --[[ )
    markToken(/(--(?!\[\[).*)$/gm, 'cmt');

    // Strings: double-quoted, single-quoted, multi-line [[ ]]
    markToken(/\x22([^\x22\\]|\\.)*\x22/g, 'str');
    markToken(/'([^'\\]|\\.)*'/g, 'str');
    markToken(/\[\[[\s\S]*?\]\]/g, 'str');

    // Numbers
    markToken(/\b(0x[0-9a-fA-F]+|[0-9]+\.?[0-9]*(?:e[+-]?[0-9]+)?)\b/g, 'num');

    // Booleans and nil
    markToken(/\b(true|false|nil)\b/g, 'bool');

    // self
    markToken(/\bself\b/g, 'self');

    // Keywords
    markToken(/\b(and|break|continue|do|else|elseif|end|for|function|if|in|local|not|or|repeat|return|then|until|while|type|export)\b/g, 'kw');

    // Built-in globals
    markToken(/\b(game|workspace|script|print|warn|error|require|typeof|tostring|tonumber|pcall|xpcall|select|unpack|rawset|rawget|setmetatable|getmetatable|ipairs|pairs|next|table|string|math|coroutine|task|Instance|Vector3|Vector2|CFrame|Color3|BrickColor|UDim2|UDim|Enum|Ray|Region3|Axes|Faces|TweenInfo|NumberRange|NumberSequence|ColorSequence|Random|tick|wait|spawn|delay)\b/g, 'global');

    // Function calls: word followed by (
    markToken(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, 'fn');

    // Sort tokens by position
    tokens.sort(function(a, b) { return a.s - b.s; });

    // Build the result string
    var q = String.fromCharCode(34); // double-quote char
    var result = '';
    var pos = 0;
    for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t];
        if (tok.s > pos) result += src.substring(pos, tok.s);
        result += '<span class=' + q + tok.cls + q + '>' + src.substring(tok.s, tok.e) + '</span>';
        pos = tok.e;
    }
    if (pos < src.length) result += src.substring(pos);
    return result;
}
</script>
</body>
</html>";
    }

    public void LoadScript(string treePath, string scriptName)
    {
        _scriptPath = treePath;
        _scriptName = scriptName;
        _currentSource = "";
        _pendingSource = null;
        TitleText.Text = $"Decompiler — {scriptName}";
        LoadingOverlay.Visibility = Visibility.Visible;
        DumpBtn.IsEnabled = false;
        CopyBtn.IsEnabled = false;
        InsertBtn.IsEnabled = false;

        var requestId = Guid.NewGuid().ToString("N");
        RelayDexRequest?.Invoke(_pid, "dex_decompile", treePath, requestId);
    }

    public void OnDecompileResult(string source, string scriptName, string fullName, bool success)
    {
        Dispatcher.Invoke(async () =>
        {
            _scriptName = string.IsNullOrEmpty(scriptName) ? _scriptName : scriptName;
            _currentSource = source;
            TitleText.Text = $"Decompiler — {_scriptName}";
            LoadingOverlay.Visibility = Visibility.Collapsed;
            DumpBtn.IsEnabled = true;
            CopyBtn.IsEnabled = true;
            InsertBtn.IsEnabled = true;

            if (_webViewReady && CodeWebView.CoreWebView2 != null)
            {
                var escaped = JsonSerializer.Serialize(source);
                await CodeWebView.CoreWebView2.ExecuteScriptAsync($"setCode({escaped})");
            }
            else
            {
                // WebView not ready yet — buffer the source for when it finishes loading
                _pendingSource = source;
            }
        });
    }

    public void OnDumpResult(string dump, bool success)
    {
        Dispatcher.Invoke(async () =>
        {
            _currentSource += "\n\n" + dump;
            DumpBtn.IsEnabled = true;

            if (_webViewReady && CodeWebView.CoreWebView2 != null)
            {
                var escaped = JsonSerializer.Serialize("\n\n" + dump);
                await CodeWebView.CoreWebView2.ExecuteScriptAsync($"appendCode({escaped})");
            }
        });
    }

    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2) return;
        DragMove();
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        Hide();
    }

    private void Copy_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrEmpty(_currentSource))
            Clipboard.SetText(_currentSource);
    }

    private void InsertToEditor_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrEmpty(_currentSource))
            InsertToEditorCallback?.Invoke(_scriptName, _currentSource);
    }

    private void DumpFunctions_Click(object sender, RoutedEventArgs e)
    {
        DumpBtn.IsEnabled = false;
        var requestId = Guid.NewGuid().ToString("N");
        RelayDexRequest?.Invoke(_pid, "dex_dumpFunctions", _scriptPath, requestId);
    }
}
