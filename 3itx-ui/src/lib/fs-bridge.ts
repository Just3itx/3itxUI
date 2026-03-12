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
export async function executeOnClients(pids: number[], script: string): Promise<boolean> {
    if (isWebView2()) {
        const data = await send({ action: "executeOnClients", pids, script });
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

/** Enable/disable console redirect (hookfunction print/warn/error) on all connected clients */
export async function setConsoleRedirect(enabled: boolean): Promise<boolean> {
    if (isWebView2()) {
        await send({ action: "setConsoleRedirect", enabled });
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
