using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;

namespace _3itx_launcher;

/// <summary>
/// Adds invisible WPF overlay grips at all edges/corners of a borderless window.
/// These grips sit ON TOP of WebView2 and trigger native Win32 resize via SendMessage.
/// 
/// Works by wrapping the window's existing Content in a new Grid and adding
/// transparent resize grip elements on top, ensuring they're above everything
/// including WebView2.
/// </summary>
public static class WindowResizeHelper
{
    private const int GripSize = 1;
    private const int CornerSize = 6;

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    private const uint WM_SYSCOMMAND = 0x0112;

    private const int SC_SIZE_LEFT        = 0xF001;
    private const int SC_SIZE_RIGHT       = 0xF002;
    private const int SC_SIZE_TOP         = 0xF003;
    private const int SC_SIZE_TOPLEFT     = 0xF004;
    private const int SC_SIZE_TOPRIGHT    = 0xF005;
    private const int SC_SIZE_BOTTOM      = 0xF006;
    private const int SC_SIZE_BOTTOMLEFT  = 0xF007;
    private const int SC_SIZE_BOTTOMRIGHT = 0xF008;

    public static void EnableResize(Window window)
    {
        window.Loaded += (s, e) =>
        {
            if (window.ResizeMode != ResizeMode.CanResize &&
                window.ResizeMode != ResizeMode.CanResizeWithGrip)
                return;

            var handle = new WindowInteropHelper(window).Handle;

            // Take the window's current content and wrap it in a new Grid
            var existingContent = window.Content as UIElement;
            if (existingContent == null) return;

            window.Content = null; // Detach

            var wrapperGrid = new Grid();
            wrapperGrid.Children.Add(existingContent);

            // Add edge grips (these sit on top of the existing content including WebView2)
            // Left edge
            AddGrip(wrapperGrid, handle, new Thickness(0), 
                HorizontalAlignment.Left, VerticalAlignment.Stretch, 
                GripSize, double.NaN, Cursors.SizeWE, SC_SIZE_LEFT);

            // Right edge
            AddGrip(wrapperGrid, handle, new Thickness(0), 
                HorizontalAlignment.Right, VerticalAlignment.Stretch, 
                GripSize, double.NaN, Cursors.SizeWE, SC_SIZE_RIGHT);

            // Top edge
            AddGrip(wrapperGrid, handle, new Thickness(0), 
                HorizontalAlignment.Stretch, VerticalAlignment.Top, 
                double.NaN, GripSize, Cursors.SizeNS, SC_SIZE_TOP);

            // Bottom edge
            AddGrip(wrapperGrid, handle, new Thickness(0), 
                HorizontalAlignment.Stretch, VerticalAlignment.Bottom, 
                double.NaN, GripSize, Cursors.SizeNS, SC_SIZE_BOTTOM);

            // Corner grips (larger, on top of edge grips)
            AddGrip(wrapperGrid, handle, new Thickness(0), 
                HorizontalAlignment.Left, VerticalAlignment.Top, 
                CornerSize, CornerSize, Cursors.SizeNWSE, SC_SIZE_TOPLEFT);

            AddGrip(wrapperGrid, handle, new Thickness(0), 
                HorizontalAlignment.Right, VerticalAlignment.Top, 
                CornerSize, CornerSize, Cursors.SizeNESW, SC_SIZE_TOPRIGHT);

            AddGrip(wrapperGrid, handle, new Thickness(0), 
                HorizontalAlignment.Left, VerticalAlignment.Bottom, 
                CornerSize, CornerSize, Cursors.SizeNESW, SC_SIZE_BOTTOMLEFT);

            AddGrip(wrapperGrid, handle, new Thickness(0), 
                HorizontalAlignment.Right, VerticalAlignment.Bottom, 
                CornerSize, CornerSize, Cursors.SizeNWSE, SC_SIZE_BOTTOMRIGHT);

            window.Content = wrapperGrid;
        };
    }

    private static void AddGrip(Grid parent, IntPtr hwnd, Thickness margin,
        HorizontalAlignment hAlign, VerticalAlignment vAlign,
        double width, double height, Cursor cursor, int sizeDirection)
    {
        var grip = new Border
        {
            Background = Brushes.Transparent,
            Cursor = cursor,
            HorizontalAlignment = hAlign,
            VerticalAlignment = vAlign,
            Margin = margin,
            IsHitTestVisible = true,
        };

        if (!double.IsNaN(width)) grip.Width = width;
        if (!double.IsNaN(height)) grip.Height = height;

        grip.MouseLeftButtonDown += (s, e) =>
        {
            e.Handled = true;
            SendMessage(hwnd, WM_SYSCOMMAND, new IntPtr(sizeDirection), IntPtr.Zero);
        };

        parent.Children.Add(grip);
    }
}
