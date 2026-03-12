using System.Diagnostics;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace _3itx_launcher;

public partial class MonitorWindow : Window
{
    private readonly int _pid;
    private readonly DispatcherTimer _timer;
    private IntPtr _hWnd;
    private int _frameCount;
    private DateTime _fpsStart = DateTime.UtcNow;
    private bool _capturing;
    private int _errorCount;
    private bool _uncapped;

    public MonitorWindow(int pid, string username, IntPtr hWnd)
    {
        InitializeComponent();
        _pid = pid;
        _hWnd = hWnd;
        TitleText.Text = $"Monitor — {username} (PID {pid})";

        _timer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(100) // ~10 FPS
        };
        _timer.Tick += Timer_Tick;
        _timer.Start();
    }

    private void Uncap_Click(object sender, RoutedEventArgs e)
    {
        _uncapped = !_uncapped;

        if (_uncapped)
        {
            // Stop timer, use CompositionTarget for uncapped rendering
            _timer.Stop();
            CompositionTarget.Rendering += OnRendering;
            UncapBtn.Content = "Cap";
            UncapBtn.Background = new SolidColorBrush(Color.FromArgb(0x30, 0x22, 0xC5, 0x5E));
            UncapBtn.Foreground = new SolidColorBrush(Color.FromRgb(0x22, 0xC5, 0x5E));
            UncapBtn.BorderBrush = new SolidColorBrush(Color.FromArgb(0x50, 0x22, 0xC5, 0x5E));
        }
        else
        {
            // Stop rendering, resume timer
            CompositionTarget.Rendering -= OnRendering;
            _timer.Start();
            UncapBtn.Content = "Uncap";
            UncapBtn.Background = Brushes.Transparent;
            UncapBtn.Foreground = new SolidColorBrush(Color.FromRgb(0x52, 0x52, 0x5B));
            UncapBtn.BorderBrush = new SolidColorBrush(Color.FromArgb(0x28, 0xFF, 0xFF, 0xFF));
        }
    }

    private void OnRendering(object? sender, EventArgs e)
    {
        CaptureFrame();
    }

    private void Timer_Tick(object? sender, EventArgs e)
    {
        CaptureFrame();
    }

    private void CaptureFrame()
    {
        if (_capturing) return;
        _capturing = true;

        try
        {
            // Check if process is still alive
            try { Process.GetProcessById(_pid); }
            catch
            {
                _timer.Stop();
                if (_uncapped) CompositionTarget.Rendering -= OnRendering;
                TitleText.Text += " (Closed)";
                LoadingText.Text = "Process ended.";
                LoadingText.Visibility = Visibility.Visible;
                _capturing = false;
                return;
            }

            // Re-fetch window handle in case Roblox recreated its window
            try
            {
                var proc = Process.GetProcessById(_pid);
                if (proc.MainWindowHandle != IntPtr.Zero)
                    _hWnd = proc.MainWindowHandle;
            }
            catch { }

            if (_hWnd == IntPtr.Zero) { _capturing = false; return; }
            if (!MainWindow.GetWindowRect(_hWnd, out var rect)) { _capturing = false; return; }

            int w = rect.Right - rect.Left;
            int h = rect.Bottom - rect.Top;
            if (w <= 0 || h <= 0 || w > 4096 || h > 4096) { _capturing = false; return; }

            IntPtr hBitmap = IntPtr.Zero;
            try
            {
                using var bmp = new System.Drawing.Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format24bppRgb);
                using (var gfx = System.Drawing.Graphics.FromImage(bmp))
                {
                    var hdc = gfx.GetHdc();
                    try
                    {
                        if (!MainWindow.PrintWindow(_hWnd, hdc, 2))
                            MainWindow.PrintWindow(_hWnd, hdc, 0);
                    }
                    finally
                    {
                        gfx.ReleaseHdc(hdc);
                    }
                }

                hBitmap = bmp.GetHbitmap();
                var source = System.Windows.Interop.Imaging.CreateBitmapSourceFromHBitmap(
                    hBitmap, IntPtr.Zero, Int32Rect.Empty,
                    BitmapSizeOptions.FromEmptyOptions());
                source.Freeze();
                CaptureImage.Source = source;
                LoadingText.Visibility = Visibility.Collapsed;
                _errorCount = 0;
            }
            catch (OutOfMemoryException)
            {
                Debug.WriteLine("[Monitor] OOM — skipping frame");
                _errorCount++;
            }
            finally
            {
                if (hBitmap != IntPtr.Zero)
                    DeleteObject(hBitmap);
            }

            // FPS counter
            _frameCount++;
            var elapsed = (DateTime.UtcNow - _fpsStart).TotalSeconds;
            if (elapsed >= 1.0)
            {
                FpsText.Text = $"{_frameCount} FPS";
                _frameCount = 0;
                _fpsStart = DateTime.UtcNow;
            }

            if (_errorCount > 5)
            {
                _timer.Interval = TimeSpan.FromMilliseconds(1000);
                if (_uncapped) { CompositionTarget.Rendering -= OnRendering; _uncapped = false; }
                LoadingText.Text = "Capture failing — retrying slowly...";
                LoadingText.Visibility = Visibility.Visible;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Monitor] Frame error: {ex.Message}");
            _errorCount++;
        }
        finally
        {
            _capturing = false;
        }
    }

    private void TitleBar_MouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
        {
            WindowState = WindowState == WindowState.Maximized
                ? WindowState.Normal
                : WindowState.Maximized;
        }
        else
        {
            DragMove();
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        _timer.Stop();
        if (_uncapped) CompositionTarget.Rendering -= OnRendering;
        Close();
    }

    protected override void OnClosed(EventArgs e)
    {
        _timer.Stop();
        if (_uncapped) CompositionTarget.Rendering -= OnRendering;
        base.OnClosed(e);
    }

    [System.Runtime.InteropServices.DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);
}
