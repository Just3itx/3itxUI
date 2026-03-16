using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;

namespace _3itx_launcher;

public class SynapseZAPI
{
    private static string LatestErrorMsg = "";

    /// <summary>Returns the latest error message from any action.</summary>
    public static string GetLatestErrorMessage() => LatestErrorMsg;

    /// <summary>
    /// Execute a Lua script via the Synapse Z scheduler.
    /// Returns: 0=success, 1=bin not found, 2=scheduler not found, 3=write error
    /// </summary>
    public static int Execute(string script, int PID = 0)
    {
        string mainPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Synapse Z");
        string binPath = Path.Combine(mainPath, "bin");

        if (!Directory.Exists(binPath))
        {
            LatestErrorMsg = "Bin Folder not found";
            return 1;
        }

        string schedulerPath = Path.Combine(binPath, "scheduler");
        if (!Directory.Exists(schedulerPath))
        {
            LatestErrorMsg = "Scheduler Folder not found";
            return 2;
        }

        string randomFileName = RandomString(10) + ".lua";
        string filePath = PID == 0
            ? Path.Combine(schedulerPath, randomFileName)
            : Path.Combine(schedulerPath, "PID" + PID + "_" + randomFileName);

        try
        {
            File.WriteAllText(filePath, script + "@@FileFullyWritten@@");
        }
        catch (Exception e)
        {
            LatestErrorMsg = e.Message;
            return 3;
        }

        return 0;
    }

    /// <summary>
    /// Send a command to a Synapse Z instance via named pipes.
    /// Connects to \\.\pipe\synz-{PID}, initializes a session, and sends the command.
    /// Returns: 0=success, 1=pipe not found, 2=session error, 3=send error
    /// </summary>
    public static int SendPipeCommand(string command, int PID)
    {
        string initialPipe = $"\\\\.\\pipe\\synz-{PID}";

        try
        {
            // Connect to the initial pipe to get a session pipe name
            using var client = new System.IO.Pipes.NamedPipeClientStream(".", $"synz-{PID}", System.IO.Pipes.PipeDirection.InOut);
            client.Connect(500); // 500ms timeout
            client.ReadMode = System.IO.Pipes.PipeTransmissionMode.Message;

            // Send "new" to create a session
            var newCmd = Encoding.UTF8.GetBytes("new");
            client.Write(newCmd, 0, newCmd.Length);
            client.Flush();

            // Read session pipe name
            var buf = new byte[4096];
            int read = client.Read(buf, 0, buf.Length);
            if (read == 0)
            {
                LatestErrorMsg = "Empty session pipe response";
                return 2;
            }
            string sessionPipeName = Encoding.UTF8.GetString(buf, 0, read);

            // Extract just the pipe name (remove \\.\pipe\ prefix if present)
            string sessionName = sessionPipeName;
            if (sessionName.StartsWith("\\\\.\\pipe\\"))
                sessionName = sessionName.Substring(9);

            // Connect to the session pipe
            using var session = new System.IO.Pipes.NamedPipeClientStream(".", sessionName, System.IO.Pipes.PipeDirection.InOut);
            session.Connect(500);
            session.ReadMode = System.IO.Pipes.PipeTransmissionMode.Message;

            // Protocol: write number of commands, then each command
            // We send 1 command (the actual command) + the implicit "read"
            var cmdList = new[] { command, "read" };
            var countBytes = Encoding.UTF8.GetBytes(cmdList.Length.ToString());
            session.Write(countBytes, 0, countBytes.Length);
            session.Flush();

            foreach (var cmd in cmdList)
            {
                // Write command
                var cmdBytes = Encoding.UTF8.GetBytes(cmd);
                session.Write(cmdBytes, 0, cmdBytes.Length);
                session.Flush();

                // Read number of responses
                read = session.Read(buf, 0, buf.Length);
                if (read == 0) continue;
                string respCountStr = Encoding.UTF8.GetString(buf, 0, read);
                if (!int.TryParse(respCountStr, out int numResponses)) continue;

                // Read and discard responses
                for (int i = 0; i < numResponses; i++)
                {
                    _ = session.Read(buf, 0, buf.Length);
                }
            }

            return 0;
        }
        catch (TimeoutException)
        {
            LatestErrorMsg = $"Pipe synz-{PID} not found (timeout)";
            return 1;
        }
        catch (Exception e)
        {
            LatestErrorMsg = e.Message;
            return 3;
        }
    }

    /// <summary>
    /// Get the expiry date of the SynapseZ license.
    /// Returns null on error (check GetLatestErrorMessage).
    /// </summary>
    public static DateTime? GetExpireDate()
    {
        string accKey = GetAccountKey();
        if (accKey == "")
        {
            LatestErrorMsg = "Could not find Account Key";
            return null;
        }

        try
        {
            using var client = new HttpClient();
            client.DefaultRequestHeaders.Add("User-Agent", "SYNZ-SERVICE");
            client.DefaultRequestHeaders.Add("key", accKey);

            var response = client.GetAsync("https://z-api.synapse.do/info").Result;
            if (response.StatusCode.ToString() != "418")
            {
                LatestErrorMsg = "API Error: " + response.StatusCode;
                return null;
            }

            string responseBody = response.Content.ReadAsStringAsync().Result;
            int expireDate = int.Parse(responseBody);
            return DateTimeOffset.FromUnixTimeSeconds(expireDate).UtcDateTime;
        }
        catch (Exception e)
        {
            LatestErrorMsg = e.Message;
            return null;
        }
    }

    /// <summary>
    /// Redeem a license key.
    /// Returns: 0=success, -1=no account key, -2=api error, -3=invalid license
    /// </summary>
    public static int Redeem(string license)
    {
        string accKey = GetAccountKey();
        if (accKey == "")
        {
            LatestErrorMsg = "Could not find Account Key";
            return -1;
        }

        try
        {
            using var client = new HttpClient();
            client.DefaultRequestHeaders.Add("User-Agent", "SYNZ-SERVICE");
            client.DefaultRequestHeaders.Add("key", accKey);
            client.DefaultRequestHeaders.Add("license", license);

            var response = client.PostAsync("https://z-api.synapse.do/redeem", null).Result;
            if (response.StatusCode.ToString() != "418")
            {
                if (response.StatusCode.ToString() == "Forbidden")
                {
                    LatestErrorMsg = "Invalid License";
                    return -3;
                }
                LatestErrorMsg = "API Error: " + response.StatusCode;
                return -2;
            }

            string responseBody = response.Content.ReadAsStringAsync().Result;
            if (responseBody.StartsWith("Added")) return 0;

            LatestErrorMsg = "Invalid License";
            return -3;
        }
        catch (Exception e)
        {
            LatestErrorMsg = e.Message;
            return -2;
        }
    }

    /// <summary>
    /// Reset HWID on the SynapseZ account.
    /// Returns: 0=success, -1=no key, -2=api error, -3=cooldown, -4=blacklisted
    /// </summary>
    public static int ResetHwid()
    {
        string accKey = GetAccountKey();
        if (accKey == "")
        {
            LatestErrorMsg = "Could not find Account Key";
            return -1;
        }

        try
        {
            using var client = new HttpClient();
            client.DefaultRequestHeaders.Add("User-Agent", "SYNZ-SERVICE");
            client.DefaultRequestHeaders.Add("key", accKey);

            var response = client.PostAsync("https://z-api.synapse.do/resethwid", null).Result;
            return response.StatusCode.ToString() switch
            {
                "418" => 0,
                "429" => SetError("Cooldown", -3),
                "Forbidden" => SetError("Blacklisted", -4),
                _ => SetError("API Error: " + response.StatusCode, -2),
            };
        }
        catch (Exception e)
        {
            LatestErrorMsg = e.Message;
            return -2;
        }
    }

    /// <summary>
    /// Create a SynapseZ account with a license key.
    /// Returns account key string, or "-1"/"-2"/"-3" on error.
    /// </summary>
    public static string CreateAccount(string license, bool createAccountKeyFile = true)
    {
        if (string.IsNullOrEmpty(license) || license.Length != 128)
        {
            LatestErrorMsg = "Malformed License";
            return "-1";
        }

        try
        {
            using var client = new HttpClient();
            client.DefaultRequestHeaders.Add("User-Agent", "SYNZ-SERVICE");
            client.DefaultRequestHeaders.Add("license", license);
            client.DefaultRequestHeaders.Add("hwid", "0");

            var response = client.PostAsync("https://z-api.synapse.do/createaccount", null).Result;
            if (response.StatusCode.ToString() != "418")
            {
                LatestErrorMsg = "API Error: " + response.StatusCode;
                return "-2";
            }

            string accKey = response.Content.ReadAsStringAsync().Result;
            switch (accKey)
            {
                case "0":
                    LatestErrorMsg = "Malformed License";
                    return "-1";
                case "1":
                    LatestErrorMsg = "API Error: Server assumes HWID 0 is blacklisted";
                    return "-2";
                case "2":
                    LatestErrorMsg = "License doesn't exist";
                    return "-3";
            }

            if (createAccountKeyFile)
            {
                string path = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "auth_v2.syn");
                var parentDir = Path.GetDirectoryName(path);
                if (parentDir != null && !Directory.Exists(parentDir))
                    Directory.CreateDirectory(parentDir);
                File.WriteAllText(path, accKey);
            }

            return accKey;
        }
        catch (Exception e)
        {
            LatestErrorMsg = e.Message;
            return "-2";
        }
    }

    /// <summary>Returns all running Roblox processes.</summary>
    public static Process[] GetRobloxProcesses()
        => Process.GetProcessesByName("RobloxPlayerBeta");

    /// <summary>Returns only Roblox instances that are SynZ-injected.</summary>
    public static List<Process> GetSynzRobloxInstances()
    {
        var injected = new List<Process>();
        foreach (var proc in GetRobloxProcesses())
        {
            try { if (IsSynz(proc.Id)) injected.Add(proc); }
            catch { /* skip inaccessible processes */ }
        }
        return injected;
    }

    /// <summary>Check if a Roblox process is a SynZ instance by reading the PE header.</summary>
    public static bool IsSynz(int PID = 0)
    {
        try
        {
            var process = Process.GetProcessById(PID);
            if (process.HasExited) return false;
            string? path = process.MainModule?.FileName;
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return false;

            using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var buf = new byte[0x600];
            var read = stream.Read(buf, 0, buf.Length);
            if (read < 0x100) return false;
            return Encoding.Default.GetString(buf, 0, read).Contains(".grh");
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Check if ALL Roblox instances are SynZ instances.</summary>
    public static bool AreAllInstancesSynz()
    {
        var processes = GetRobloxProcesses();
        if (processes.Length == 0) return false;
        return GetSynzRobloxInstances().Count == processes.Length;
    }

    public static string GetAccountKeyPath()
        => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "auth_v2.syn");

    public static string GetAccountKey()
    {
        string path = GetAccountKeyPath();
        return File.Exists(path) ? File.ReadAllText(path) : "";
    }

    // ─── Helpers ───

    private static int SetError(string msg, int code)
    {
        LatestErrorMsg = msg;
        return code;
    }

    private static readonly Random _random = new();

    private static string RandomString(int length)
    {
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        return new string(Enumerable.Repeat(chars, length)
            .Select(s => s[_random.Next(s.Length)]).ToArray());
    }
}
