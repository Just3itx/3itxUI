using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Threading.Tasks;

namespace _3itx_installer;

class Program
{
    // URL to the Launcher.zip hosted on GitHub releases
    private const string ZipUrl = "https://github.com/Just3itx/3itxUI/releases/download/Latest/Launcher.zip";
    private const string AppName = "3itx UI";

    static async Task Main(string[] args)
    {
        Console.Title = $"{AppName} Installer";
        SetConsoleColor(ConsoleColor.Cyan);
        Console.WriteLine(@"
  ╔══════════════════════════════════╗
  ║        3itx UI Installer        ║
  ╚══════════════════════════════════╝
");
        Console.ResetColor();

        // Determine install directory
        var installDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "3itx_UI", "App");

        if (args.Length > 0 && !string.IsNullOrWhiteSpace(args[0]))
            installDir = Path.GetFullPath(args[0]);

        Console.Write("  Install location: ");
        SetConsoleColor(ConsoleColor.White);
        Console.WriteLine(installDir);
        Console.ResetColor();
        Console.WriteLine();

        try
        {
            // Step 1: Download
            LogStep("Downloading Launcher.zip...");
            var zipPath = Path.Combine(Path.GetTempPath(), "3itx_Launcher.zip");
            await DownloadFile(ZipUrl, zipPath);
            LogSuccess($"Downloaded ({new FileInfo(zipPath).Length / 1024:N0} KB)");

            // Step 2: Extract
            LogStep("Extracting files...");
            if (Directory.Exists(installDir))
            {
                // Preserve node_modules if it exists (saves npm install time)
                var nmPath = Path.Combine(installDir, "bin", "3itx-ui", "node_modules");
                var nmBackup = Path.Combine(Path.GetTempPath(), "3itx_nm_backup");
                bool hadNm = Directory.Exists(nmPath);
                if (hadNm)
                {
                    LogInfo("Backing up node_modules...");
                    if (Directory.Exists(nmBackup)) Directory.Delete(nmBackup, true);
                    Directory.Move(nmPath, nmBackup);
                }

                Directory.Delete(installDir, true);
                ZipFile.ExtractToDirectory(zipPath, installDir, true);

                if (hadNm && Directory.Exists(nmBackup))
                {
                    var newNmPath = Path.Combine(installDir, "bin", "3itx-ui", "node_modules");
                    if (!Directory.Exists(newNmPath))
                    {
                        Directory.Move(nmBackup, newNmPath);
                        LogInfo("Restored node_modules from backup");
                    }
                    else if (Directory.Exists(nmBackup))
                    {
                        Directory.Delete(nmBackup, true);
                    }
                }
            }
            else
            {
                Directory.CreateDirectory(installDir);
                ZipFile.ExtractToDirectory(zipPath, installDir, true);
            }
            LogSuccess("Extracted");

            // Step 3: Install npm packages
            var uiDir = Path.Combine(installDir, "bin", "3itx-ui");
            if (!Directory.Exists(uiDir))
            {
                // Try without bin/ prefix (flat structure)
                uiDir = Path.Combine(installDir, "3itx-ui");
            }

            if (Directory.Exists(uiDir) && File.Exists(Path.Combine(uiDir, "package.json")))
            {
                LogStep("Installing npm packages (this may take a minute)...");
                var exitCode = await RunProcess("cmd.exe", "/c npm install", uiDir);
                if (exitCode == 0)
                    LogSuccess("Packages installed");
                else
                    LogWarning($"npm install exited with code {exitCode}");
            }
            else
            {
                LogWarning("Could not find 3itx-ui/package.json — skipping npm install");
            }

            // Step 4: Cleanup
            if (File.Exists(zipPath)) File.Delete(zipPath);

            // Step 5: Create desktop shortcut
            var exePath = FindExe(installDir);
            if (exePath != null)
            {
                LogStep("Creating desktop shortcut...");
                CreateShortcut(exePath);
                LogSuccess("Shortcut created on Desktop");
            }

            // Done!
            Console.WriteLine();
            SetConsoleColor(ConsoleColor.Green);
            Console.WriteLine("  ✅ Installation complete!");
            Console.ResetColor();
            Console.WriteLine();

            if (exePath != null)
            {
                Console.Write("  Launch now? (Y/n): ");
                var key = Console.ReadKey();
                Console.WriteLine();
                if (key.Key != ConsoleKey.N)
                {
                    Process.Start(new ProcessStartInfo(exePath) { UseShellExecute = true });
                }
            }
        }
        catch (Exception ex)
        {
            LogError($"Installation failed: {ex.Message}");
            Console.WriteLine();
            Console.WriteLine("  Press any key to exit...");
            Console.ReadKey();
        }
    }

    static async Task DownloadFile(string url, string destPath)
    {
        using var client = new HttpClient();
        client.DefaultRequestHeaders.Add("User-Agent", "3itx-Installer/1.0");
        using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();

        var totalBytes = response.Content.Headers.ContentLength ?? -1;
        using var stream = await response.Content.ReadAsStreamAsync();
        using var fs = new FileStream(destPath, FileMode.Create);

        var buffer = new byte[81920];
        long downloaded = 0;
        int read;
        while ((read = await stream.ReadAsync(buffer, 0, buffer.Length)) > 0)
        {
            await fs.WriteAsync(buffer, 0, read);
            downloaded += read;
            if (totalBytes > 0)
            {
                var pct = (int)(downloaded * 100 / totalBytes);
                Console.Write($"\r  ⬇ Downloading... {pct}% ({downloaded / 1024:N0} / {totalBytes / 1024:N0} KB)");
            }
        }
        Console.WriteLine();
    }

    static async Task<int> RunProcess(string file, string args, string workDir)
    {
        var psi = new ProcessStartInfo
        {
            FileName = file,
            Arguments = args,
            WorkingDirectory = workDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        using var proc = Process.Start(psi)!;
        // Show npm output in real-time
        proc.OutputDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
                Console.WriteLine($"    {e.Data}");
        };
        proc.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data) && !e.Data.Contains("npm warn"))
                Console.WriteLine($"    {e.Data}");
        };
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        await proc.WaitForExitAsync();
        return proc.ExitCode;
    }

    static string? FindExe(string dir)
    {
        // Look for 3itx.exe in root or bin/
        var candidates = new[]
        {
            Path.Combine(dir, "3itx.exe"),
            Path.Combine(dir, "bin", "3itx.exe"),
        };
        foreach (var c in candidates)
            if (File.Exists(c)) return c;
        return null;
    }

    static void CreateShortcut(string exePath)
    {
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
            var linkPath = Path.Combine(desktop, "3itx UI.lnk");

            // Use PowerShell to create shortcut (no COM dependency)
            var ps = $@"
$ws = New-Object -ComObject WScript.Shell;
$sc = $ws.CreateShortcut('{linkPath.Replace("'", "''")}');
$sc.TargetPath = '{exePath.Replace("'", "''")}';
$sc.WorkingDirectory = '{Path.GetDirectoryName(exePath)!.Replace("'", "''")}';
$sc.Description = '3itx UI Launcher';
$sc.Save()";
            Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -Command \"{ps.Replace("\"", "\\\"")}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
            })?.WaitForExit(5000);
        }
        catch { /* Non-critical */ }
    }

    static void LogStep(string msg)
    {
        SetConsoleColor(ConsoleColor.Cyan);
        Console.Write("  ► ");
        Console.ResetColor();
        Console.WriteLine(msg);
    }

    static void LogSuccess(string msg)
    {
        SetConsoleColor(ConsoleColor.Green);
        Console.Write("    ✓ ");
        Console.ResetColor();
        Console.WriteLine(msg);
    }

    static void LogWarning(string msg)
    {
        SetConsoleColor(ConsoleColor.Yellow);
        Console.Write("    ⚠ ");
        Console.ResetColor();
        Console.WriteLine(msg);
    }

    static void LogInfo(string msg)
    {
        SetConsoleColor(ConsoleColor.DarkGray);
        Console.Write("    ℹ ");
        Console.ResetColor();
        Console.WriteLine(msg);
    }

    static void LogError(string msg)
    {
        SetConsoleColor(ConsoleColor.Red);
        Console.Write("  ✗ ");
        Console.ResetColor();
        Console.WriteLine(msg);
    }

    static void SetConsoleColor(ConsoleColor color)
    {
        Console.ForegroundColor = color;
    }
}
