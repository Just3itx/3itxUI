using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace _3itx_launcher;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Catch unhandled exceptions on the UI thread
        DispatcherUnhandledException += (s, args) =>
        {
            try
            {
                var logPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "crash.log");
                File.AppendAllText(logPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] UI EXCEPTION: {args.Exception}\n\n");
            }
            catch { }
            args.Handled = true; // Prevent app crash
        };

        // Catch unhandled exceptions on background threads
        AppDomain.CurrentDomain.UnhandledException += (s, args) =>
        {
            try
            {
                var logPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "crash.log");
                File.AppendAllText(logPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] DOMAIN EXCEPTION: {args.ExceptionObject}\n\n");
            }
            catch { }
        };

        // Catch task exceptions
        TaskScheduler.UnobservedTaskException += (s, args) =>
        {
            try
            {
                var logPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "crash.log");
                File.AppendAllText(logPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] TASK EXCEPTION: {args.Exception}\n\n");
            }
            catch { }
            args.SetObserved();
        };
    }
}
