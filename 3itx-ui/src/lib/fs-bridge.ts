"use client";

/**
 * File system bridge for communicating with the C# WebView2 launcher.
 *
 * Priority:
 * 1. WebView2 bridge (window.chrome.webview.postMessage) — production
 * 2. API route (/api/files) — dev mode fallback
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface BridgeResponse {
    requestId: string;
    data: any;
}
// Store pending requests on window to survive HMR module re-execution
function getPending(): Map<string, (data: any) => void> {
    if (typeof window === "undefined") return new Map();
    if (!(window as any).__bridgePending) {
        (window as any).__bridgePending = new Map();
    }
    return (window as any).__bridgePending;
}

function nextReqId(): number {
    if (typeof window === "undefined") return 0;
    (window as any).__bridgeReqId = ((window as any).__bridgeReqId || 0) + 1;
    return (window as any).__bridgeReqId;
}

// C# pushes responses onto window.__bridgeQueue via ExecuteScriptAsync,
// then calls window.__bridgeDrain(). This drains any queued responses.
function drainQueue() {
    const q: BridgeResponse[] = (window as any).__bridgeQueue || [];
    (window as any).__bridgeQueue = [];
    const pending = getPending();
    for (const msg of q) {
        if (msg.requestId && pending.has(msg.requestId)) {
            pending.get(msg.requestId)!(msg.data);
            pending.delete(msg.requestId);
        }
    }
}

if (typeof window !== "undefined") {
    // Register drain function for C# to call
    (window as any).__bridgeDrain = drainQueue;
    // Drain any responses that arrived before this module loaded
    drainQueue();
}

function isWebView2(): boolean {
    return typeof window !== "undefined" && !!(window as any).chrome?.webview?.postMessage;
}

/** Check if the WebView2 bridge is available (running inside the C# launcher) */
export function isAvailable(): boolean {
    return isWebView2();
}

function send(payload: Record<string, any>): Promise<any> {
    return new Promise((resolve) => {
        const requestId = `req_${nextReqId()}_${Date.now()}`;
        getPending().set(requestId, resolve);
        (window as any).chrome.webview.postMessage({ ...payload, requestId });
        // Timeout after 5s
        setTimeout(() => {
            if (getPending().has(requestId)) {
                getPending().delete(requestId);
                resolve({ error: "timeout" });
            }
        }, 5000);
    });
}

/* ─── API fallback helpers ─── */
async function apiGet(root: string): Promise<any> {
    const res = await fetch(`/api/files?root=${root}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.tree ?? [];
}

async function apiPost(payload: Record<string, any>): Promise<any> {
    const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) return { error: "API error" };
    return await res.json();
}

export interface FileNode {
    id: string;
    name: string;
    type: "file" | "folder";
    children?: FileNode[];
}

/** List files in a root section */
export async function listFiles(root: "scripts" | "autoexec"): Promise<FileNode[]> {
    if (isWebView2()) {
        const data = await send({ action: "listFiles", root });
        return Array.isArray(data) ? data : [];
    }
    // Dev mode: use API fallback
    return await apiGet(root);
}

/** Read a file's content */
export async function readFile(root: "scripts" | "autoexec", filePath: string): Promise<string> {
    if (isWebView2()) {
        const data = await send({ action: "readFile", root, filePath });
        return data?.content ?? "";
    }
    // Dev mode: use API fallback
    const data = await apiPost({ action: "read", root, filePath });
    return data?.content ?? "";
}

/** Write content to a file */
export async function writeFile(root: "scripts" | "autoexec", filePath: string, content: string): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "writeFile", root, filePath, content });
        return !!data?.ok;
    }
    // Dev mode: use API fallback
    const data = await apiPost({ action: "write", root, filePath, content });
    return !!data?.ok;
}

/** Create an empty file */
export async function createFile(root: "scripts" | "autoexec", filePath: string): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "createFile", root, filePath });
        return !!data?.ok;
    }
    const data = await apiPost({ action: "createFile", root, filePath });
    return !!data?.ok;
}

/** Create a folder */
export async function createFolder(root: "scripts" | "autoexec", filePath: string): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "createFolder", root, filePath });
        return !!data?.ok;
    }
    const data = await apiPost({ action: "createFolder", root, filePath });
    return !!data?.ok;
}

/** Delete a file or folder */
export async function deleteFile(root: "scripts" | "autoexec", filePath: string): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "deleteFile", root, filePath });
        return !!data?.ok;
    }
    const data = await apiPost({ action: "delete", root, filePath });
    return !!data?.ok;
}

/** Rename a file or folder */
export async function renameFile(root: "scripts" | "autoexec", filePath: string, newName: string): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "rename", root, filePath, newName });
        return !!data?.ok;
    }
    const data = await apiPost({ action: "rename", root, filePath, newName });
    return !!data?.ok;
}

/** Open folder in OS file explorer */
export async function openFolder(root: "scripts" | "autoexec", filePath?: string): Promise<void> {
    if (isWebView2()) {
        await send({ action: "openFolder", root, filePath: filePath ?? "" });
        return;
    }
    // No fallback for opening folder in browser
}

/** Move a file or folder from one section to another (scripts ↔ autoexec) */
export async function moveToSection(
    fromRoot: "scripts" | "autoexec",
    toRoot: "scripts" | "autoexec",
    filePath: string
): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "moveToSection", root: fromRoot, toRoot, filePath });
        return !!data?.ok;
    }
    const data = await apiPost({ action: "moveToSection", root: fromRoot, toRoot, filePath });
    return !!data?.ok;
}

/** Move a file/folder within the same section (e.g., from root to a subfolder) */
export async function moveInFolder(
    root: "scripts" | "autoexec",
    fromPath: string,
    toFolder: string
): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "moveInFolder", root, filePath: fromPath, toFolder });
        return !!data?.ok;
    }
    const data = await apiPost({ action: "moveInFolder", root, filePath: fromPath, toFolder });
    return !!data?.ok;
}

/** Sync auto execute: enable copies scripts to Synapse Z autoexec, disable removes 3itx_ files */
export async function syncAutoExec(enable: boolean): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "syncAutoExec", enable: enable ? "true" : "false" });
        return !!data?.ok;
    }
    return false;
}

/** Open an external folder path (e.g., Synapse Z autoexec/workspace) */
export async function openExternalFolder(folderKey: string): Promise<void> {
    if (isWebView2()) {
        await send({ action: "openExternalFolder", folderKey });
    }
}

/* ─── Account Manager / WebSocket Client Bridge ─── */

/** Get list of connected Roblox clients */
export async function getClients(): Promise<any[]> {
    if (isWebView2()) {
        const data = await send({ action: "getClients" });
        return Array.isArray(data) ? data : [];
    }
    return [];
}

/** Execute a script on specific PIDs */
export async function executeOnClients(pids: number[], script: string, method?: "piper" | "scheduler"): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "executeOnClients", pids, script, method: method ?? "scheduler" });
        return !!data?.ok;
    }
    return false;
}

/** Kill a Roblox process by PID */
export async function killClient(pid: number): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "killClient", pid });
        return !!data?.ok;
    }
    return false;
}

/** Force refresh client list (re-polls processes) */
export async function refreshClients(): Promise<any[]> {
    if (isWebView2()) {
        const data = await send({ action: "refreshClients" });
        return Array.isArray(data) ? data : [];
    }
    return [];
}

/** Enable/disable console redirect on all connected clients
 * @param method "script" = Lua hookfunction, "api" = SynapseZAPI2 pipe output
 */
export async function setConsoleRedirect(enabled: boolean, method: "script" | "api" = "script"): Promise<boolean> {
    if (isWebView2()) {
        await send({ action: "setConsoleRedirect", enabled, method });
        return true;
    }
    return false;
}

/** Launch Roblox via the Start Menu shortcut */
export async function launchRoblox(): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "launchRoblox" });
        return data?.ok === true;
    }
    return false;
}

/** Enable/disable LSP Connect (in-game datamodel sync) on all connected clients */
export async function setLSPConnect(enabled: boolean): Promise<boolean> {
    if (isWebView2()) {
        await send({ action: "setLSPConnect", enabled });
        return true;
    }
    return false;
}

/** Enable/disable FPS unlock (setfpscap) on all connected clients */
export async function setUnlockFPS(enabled: boolean): Promise<boolean> {
    if (isWebView2()) {
        await send({ action: "setUnlockFPS", enabled });
        return true;
    }
    return false;
}

/** Enable/disable always-on-top window mode */
export async function setTopMost(enabled: boolean): Promise<boolean> {
    if (isWebView2()) {
        await send({ action: "setTopMost", enabled });
        return true;
    }
    return false;
}

/** Open a native monitor window for a Roblox client (by PID). Re-opens if already exists. */
export async function openMonitor(pid: number, username: string): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "openMonitor", pid, username });
        return data?.ok === true;
    }
    return false;
}

/** Change the window title of a Roblox instance by PID */
export async function setWindowTitle(pid: number, title: string): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "setWindowTitle", pid, title });
        return data?.ok === true;
    }
    return false;
}

/** Show a native Windows join notification popup on the Roblox monitor */
export async function showJoinNotification(params: {
    displayName: string;
    username: string;
    avatarUrl: string;
    jobId: string;
    robloxPid: number;
    userId: number;
    duration: number;
}): Promise<boolean> {
    if (isWebView2()) {
        await send({ action: "showJoinNotification", ...params });
        return true;
    }
    return false;
}

/** Capture a screenshot of a Roblox window by PID */
export async function captureWindow(pid: number): Promise<string | null> {
    if (isWebView2()) {
        const data = await send({ action: "captureWindow", pid });
        return data?.image ?? null;
    }
    return null;
}

/** Queue a command for Synapse Z (e.g. "reload_settings") */
export async function queueCommand(command: string, pid?: number): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "queueCommand", command, pid: pid ?? 0 });
        return data?.ok === true;
    }
    return false;
}

/** Get Synapse Z account info (expiry, version, status) */
export async function getAccountInfo(): Promise<{ hasAccount: boolean; expiry: string; version: string; binExists: boolean; accountKey: string; error: string } | null> {
    if (isWebView2()) {
        return await send({ action: "getAccountInfo" });
    }
    return null;
}

/** Redeem a license key */
export async function redeemKey(license: string): Promise<{ code: number; error: string } | null> {
    if (isWebView2()) {
        return await send({ action: "redeemKey", license });
    }
    return null;
}

/** Reset HWID */
export async function resetHwid(): Promise<{ code: number; error: string } | null> {
    if (isWebView2()) {
        return await send({ action: "resetHwid" });
    }
    return null;
}

/** Open a URL in the default system browser */
export async function openUrl(url: string): Promise<void> {
    if (isWebView2()) {
        // Send via bridge — C# handler opens in default browser via cmd /c start
        await send({ action: "openUrl", url });
        return;
    }
    // Dev mode fallback
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/** Create a new Synapse Z account */
export async function createAccount(license: string): Promise<{ ok: boolean; error: string } | null> {
    if (isWebView2()) {
        return await send({ action: "createAccount", license });
    }
    return null;
}

/* ─── DEX Explorer Bridge ─── */

/** Open a DEX Explorer window for a specific client */
export async function openDexExplorer(pid: number, username: string): Promise<void> {
    if (isWebView2()) {
        await send({ action: "openDexExplorer", pid, username });
    }
}

/** Ensure DEX icons are downloaded (Icons.zip → DexIcons/) */
export async function ensureDexIcons(): Promise<{ ok: boolean; alreadyExists?: boolean; error?: string } | null> {
    if (isWebView2()) {
        return await send({ action: "ensureDexIcons" });
    }
    return null;
}

/** Get DEX class icons as className → data:image/png;base64,... map */
export async function getDexIcons(): Promise<{ ok: boolean; icons?: Record<string, string>; error?: string } | null> {
    if (isWebView2()) {
        return await send({ action: "getDexIcons" });
    }
    return null;
}

/** Send a DEX query to a specific Roblox client via WS */
export async function dexRequest(pid: number, type: string, data: Record<string, unknown> = {}): Promise<boolean> {
    if (!isWebView2()) return false;
    const message = { type, ...data };
    const result = await send({ action: "sendDexMessage", pid, message });
    return !!result?.ok;
}

// DEX data callback registry
type DexCallback = (pid: number, data: unknown) => void;
const _dexCallbacks: DexCallback[] = [];

export function onDexData(cb: DexCallback): void {
    _dexCallbacks.push(cb);
}

export function offDexData(cb: DexCallback): void {
    const idx = _dexCallbacks.indexOf(cb);
    if (idx >= 0) _dexCallbacks.splice(idx, 1);
}

// Register the global handler
if (typeof window !== "undefined") {
    (window as any).__dexDiag = { calls: 0, cbCount: 0, lastType: "", lastPid: 0, errors: 0 };
    (window as any).__onDexData = (pid: number, rawJson: string) => {
        const diag = (window as any).__dexDiag;
        diag.calls++;
        diag.cbCount = _dexCallbacks.length;
        diag.lastPid = pid;
        try {
            const data = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
            diag.lastType = data?.type || "unknown";
            for (const cb of _dexCallbacks) {
                cb(pid, data);
            }
        } catch (e: any) {
            diag.errors++;
            diag.lastError = e?.message;
        }
    };
}

/** Show a native WPF context menu for the DEX explorer (delegates to C#) */
export async function showDexContextMenu(x: number, y: number, path: string, name: string, isRoot: boolean, hasCopied: boolean = false, isSearchResult: boolean = false, treePath?: string, className?: string): Promise<void> {
    if (isWebView2()) {
        await send({ action: "showDexContextMenu", x, y, path, name, isRoot, hasCopied, isSearchResult, treePath: treePath || path, className: className || "" });
    }
}

/** Notify C# that a DEX node was double-clicked (for script decompilation) */
export async function dexDoubleClick(treePath: string, name: string, className: string): Promise<void> {
    if (isWebView2()) {
        await send({ action: "dexDoubleClick", treePath, name, className });
    }
}

/** Close any open DEX context menu */
export async function closeDexContextMenu(): Promise<void> {
    if (isWebView2()) {
        await send({ action: "closeDexContextMenu" });
    }
}
