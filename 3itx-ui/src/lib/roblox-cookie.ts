import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

let cachedCookie: string | null = null;
let cachedCsrf: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 1000 * 60 * 30; // 30 min cache

export async function decryptRobloxCookie(): Promise<string | null> {
    // Check cache
    if (cachedCookie && Date.now() - cacheTime < CACHE_TTL) {
        return cachedCookie;
    }

    const cookiePath = path.join(
        process.env.LOCALAPPDATA || "",
        "Roblox",
        "LocalStorage",
        "RobloxCookies.dat"
    );

    if (!fs.existsSync(cookiePath)) {
        console.error("[Cookie] RobloxCookies.dat not found at:", cookiePath);
        return null;
    }

    const raw = fs.readFileSync(cookiePath, "utf-8");
    let base64Data: string;
    try {
        const parsed = JSON.parse(raw);
        base64Data = parsed.CookiesData;
        if (!base64Data) {
            console.error("[Cookie] No CookiesData in file");
            return null;
        }
    } catch {
        console.error("[Cookie] Failed to parse RobloxCookies.dat as JSON");
        return null;
    }

    // Escape the base64 data for PowerShell (it might contain + and / but no quotes)
    const psScript = [
        "Add-Type -AssemblyName System.Security",
        `$bytes = [Convert]::FromBase64String('${base64Data}')`,
        "$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[System.Text.Encoding]::UTF8.GetString($decrypted)",
    ].join("; ");

    try {
        const { stdout } = await execAsync(
            `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"')}"`,
            { maxBuffer: 1024 * 1024 }
        );

        const decrypted = stdout.trim();
        // The decrypted string looks like: #HttpOnly_.roblox.com ... .ROBLOSECURITY _|WARNING...|_COOKIE_VALUE; ...
        const match = decrypted.match(/\.ROBLOSECURITY\s+([^\s;]+)/);
        if (match) {
            cachedCookie = match[1];
            cacheTime = Date.now();
            cachedCsrf = null; // Reset CSRF when cookie changes
            console.log("[Cookie] Successfully decrypted .ROBLOSECURITY");
            return cachedCookie;
        }

        console.error("[Cookie] .ROBLOSECURITY not found in decrypted data");
        return null;
    } catch (err) {
        console.error("[Cookie] DPAPI decryption failed:", err);
        return null;
    }
}

export async function getCsrfToken(cookie: string): Promise<string | null> {
    if (cachedCsrf) return cachedCsrf;

    try {
        const res = await fetch("https://auth.roblox.com/v2/logout", {
            method: "POST",
            headers: {
                Cookie: `.ROBLOSECURITY=${cookie}`,
            },
        });
        const csrf = res.headers.get("x-csrf-token");
        if (csrf) {
            cachedCsrf = csrf;
            return csrf;
        }
    } catch (err) {
        console.error("[Cookie] CSRF fetch failed:", err);
    }
    return null;
}

export function invalidateCsrf() {
    cachedCsrf = null;
}
