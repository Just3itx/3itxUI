using System;
using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace _3itx_launcher;

public partial class NotificationWindow : Window
{
    private readonly DispatcherTimer _timer;
    private readonly int _duration;
    private readonly int _robloxPid;
    private DateTime _start;
    private static readonly HttpClient _http = new(new HttpClientHandler
    {
        AllowAutoRedirect = true,
        MaxAutomaticRedirections = 5
    })
    {
        Timeout = TimeSpan.FromSeconds(8)
    };

    static NotificationWindow()
    {
        _http.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0");
    }

    public NotificationWindow(
        string displayName,
        string username,
        string avatarUrl,
        string jobId,
        int robloxPid,
        int durationSeconds = 5,
        long userId = 0)
    {
        InitializeComponent();

        _duration = durationSeconds;
        _robloxPid = robloxPid;

        // Start offscreen so the window doesn't flash at (0,0) before positioning
        Left = -9999;
        Top = -9999;

        DisplayNameText.Text = displayName;
        UsernameText.Text = $"@{username}";
        JobIdText.Text = string.IsNullOrEmpty(jobId) ? "N/A" : (jobId.Length > 24 ? jobId[..24] + "…" : jobId);
        TimerText.Text = $"{_duration}s";

        // Load avatar — prefer userId for reliable CDN URL
        LoadAvatar(userId, avatarUrl);

        _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        _timer.Tick += Timer_Tick;
        Loaded += OnLoaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Defer all heavy work (layout + positioning) so the window shows without freezing
        Dispatcher.BeginInvoke(DispatcherPriority.Loaded, () =>
        {
            try
            {
                UpdateLayout();
                PositionOnRobloxMonitor(_robloxPid);
                ProgressBar.Width = CardBorder.ActualWidth;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Notification] OnLoaded positioning error: {ex.Message}");
                try
                {
                    var primary = SystemParameters.WorkArea;
                    Left = primary.Right - ActualWidth;
                    Top = primary.Bottom - ActualHeight;
                    ProgressBar.Width = CardBorder.ActualWidth;
                }
                catch { }
            }

            _start = DateTime.UtcNow;
            _timer.Start();

            var slideIn = new DoubleAnimation(340, 0, TimeSpan.FromMilliseconds(300))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };
            SlideTransform.BeginAnimation(TranslateTransform.XProperty, slideIn);
        });
    }

    private void Timer_Tick(object? sender, EventArgs e)
    {
        var elapsed = (DateTime.UtcNow - _start).TotalSeconds;
        var remaining = Math.Max(0, _duration - elapsed);
        var ratio = remaining / _duration;

        var fullWidth = CardBorder.ActualWidth;
        if (fullWidth > 0)
            ProgressBar.Width = fullWidth * ratio;
        TimerText.Text = $"{Math.Ceiling(remaining)}s";

        if (remaining <= 0)
        {
            _timer.Stop();
            var slideOut = new DoubleAnimation(0, 340, TimeSpan.FromMilliseconds(250))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
            };
            slideOut.Completed += (_, _) => Close();
            SlideTransform.BeginAnimation(TranslateTransform.XProperty, slideOut);
        }
    }

    private void PositionOnRobloxMonitor(int robloxPid)
    {
        try
        {
            var proc = Process.GetProcessById(robloxPid);
            var hWnd = proc.MainWindowHandle;
            if (hWnd != IntPtr.Zero)
            {
                var hMonitor = MonitorFromWindow(hWnd, 2);
                var mi = new MONITORINFO();
                mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
                if (GetMonitorInfo(hMonitor, ref mi))
                {
                    var source = PresentationSource.FromVisual(this);
                    double sx, sy;
                    if (source?.CompositionTarget != null)
                    {
                        sx = source.CompositionTarget.TransformFromDevice.M11;
                        sy = source.CompositionTarget.TransformFromDevice.M22;
                    }
                    else
                    {
                        var dpi = GetDpiForWindow(hWnd);
                        if (dpi == 0) dpi = 96;
                        sx = 96.0 / dpi; sy = sx;
                    }
                    Left = mi.rcWork.Right * sx - ActualWidth;
                    Top = mi.rcWork.Bottom * sy - ActualHeight;
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Notification] Position error: {ex.Message}");
        }
        var primary = SystemParameters.WorkArea;
        Left = primary.Right - ActualWidth;
        Top = primary.Bottom - ActualHeight;
    }

    private async void LoadAvatar(long userId, string fallbackUrl)
    {
        try
        {
            string? cdnUrl = null;

            // Use thumbnails API directly with userId for a reliable CDN link
            if (userId > 0)
            {
                try
                {
                    var apiUrl = $"https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={userId}&size=150x150&format=Png&isCircular=false";
                    var json = await _http.GetStringAsync(apiUrl);
                    var doc = JsonDocument.Parse(json);
                    var data = doc.RootElement.GetProperty("data");
                    if (data.GetArrayLength() > 0)
                    {
                        var url = data[0].GetProperty("imageUrl").GetString();
                        if (!string.IsNullOrEmpty(url)) cdnUrl = url;
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Notification] Thumbnails API: {ex.Message}");
                }
            }

            if (string.IsNullOrEmpty(cdnUrl)) cdnUrl = fallbackUrl;
            if (string.IsNullOrEmpty(cdnUrl)) return;

            var bytes = await _http.GetByteArrayAsync(cdnUrl);

            await Dispatcher.InvokeAsync(() =>
            {
                var bmp = new BitmapImage();
                using (var stream = new System.IO.MemoryStream(bytes))
                {
                    bmp.BeginInit();
                    bmp.CacheOption = BitmapCacheOption.OnLoad;
                    bmp.StreamSource = stream;
                    bmp.EndInit();
                    bmp.Freeze();
                }
                AvatarBrush.ImageSource = bmp;
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Notification] Avatar error: {ex.Message}");
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int dwFlags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);

    protected override void OnClosed(EventArgs e) { _timer.Stop(); base.OnClosed(e); }
}
