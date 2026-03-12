"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import TitleBar from "@/components/title-bar";
import Sidebar, { type PanelName } from "@/components/sidebar";
import ExplorerPanel, { type ExplorerNode } from "@/components/explorer-panel";
import EditorPanel, { type EditorTab } from "@/components/editor-panel";
import ConsolePanel, { type ConsoleLine } from "@/components/console-panel";
import SettingsPanel, { type ExecutorSettings } from "@/components/settings-panel";
import ScriptHubPanel from "@/components/script-hub-panel";
import AccountManagerPanel, { type ClientInfo } from "@/components/account-manager";
import RegionsPanel from "@/components/regions-panel";
import StatusBar from "@/components/status-bar";
import { ToastContainer, useToast } from "@/components/toast";
import { cn } from "@/lib/utils";
import * as fsBridge from "@/lib/fs-bridge";
import * as lspStore from "@/lib/lsp-store";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function loadSettings(): ExecutorSettings {
  if (typeof window === "undefined") return defaultSettings();
  try {
    const raw = localStorage.getItem("3itx-settings");
    return raw ? { ...defaultSettings(), ...JSON.parse(raw) } : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

function defaultSettings(): ExecutorSettings {
  return {
    topMost: false,
    autoExec: false,
    lspConnect: false,
    unlockFPS: false,
    debugMode: false,
    redirectConsole: false,
    wordWrap: false,
    lineNumbers: true,
    bracketPairColorization: true,
    joinNotifications: true,
    joinNotificationDuration: 5,
    opacity: 100,
    editorFont: 13,
    theme: "default",
  };
}

/* ─── Default trees (fallback for initial render before API load) ─── */
const DEFAULT_SCRIPTS: ExplorerNode[] = [];
const DEFAULT_AUTOEXEC: ExplorerNode[] = [];

/* ─── Tab cache ─── */
function loadCachedTabs(): { tabs: EditorTab[]; activeId: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("3itx-tabs");
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.tabs?.length > 0) return data;
  } catch { }
  return null;
}

function saveCachedTabs(tabs: EditorTab[], activeId: number) {
  try {
    localStorage.setItem("3itx-tabs", JSON.stringify({ tabs, activeId }));
  } catch { }
}

export default function Home() {
  // Panel (sidebar navigation)
  const [panel, setPanel] = useState<PanelName>("editor");

  // Explorer
  const [scriptsTree, setScriptsTree] = useState<ExplorerNode[]>(DEFAULT_SCRIPTS);
  const [autoExecTree, setAutoExecTree] = useState<ExplorerNode[]>(DEFAULT_AUTOEXEC);
  const [explorerSearch, setExplorerSearch] = useState("");

  // Fetch explorer trees from filesystem bridge (uses WebView2 or API fallback)
  const refreshExplorer = useCallback(async () => {
    try {
      console.log("[Explorer] refreshExplorer called, isWebView2:", fsBridge.isAvailable());
      const [scripts, autoexec] = await Promise.all([
        fsBridge.listFiles("scripts"),
        fsBridge.listFiles("autoexec"),
      ]);
      console.log("[Explorer] scripts:", JSON.stringify(scripts).slice(0, 500), "len:", scripts.length);
      console.log("[Explorer] autoexec:", JSON.stringify(autoexec).slice(0, 500), "len:", autoexec.length);
      // Only update if we got real data — prevents timeouts from wiping the tree
      if (scripts.length > 0) setScriptsTree(scripts);
      if (autoexec.length > 0) setAutoExecTree(autoexec);
    } catch (err) {
      console.error("[Explorer] refreshExplorer failed:", err);
    }
  }, []);

  // Load explorer trees on mount with retry, and auto-refresh periodically
  useEffect(() => {
    let retryCount = 0;
    const tryRefresh = async () => {
      await refreshExplorer();
      retryCount++;
      // Retry up to 3 times with 1s delay if no files found
      if (retryCount < 3) {
        setTimeout(tryRefresh, 1000);
      }
    };
    tryRefresh();

    // Auto-refresh every 10 seconds to pick up external changes
    const interval = setInterval(refreshExplorer, 10000);
    return () => clearInterval(interval);
  }, [refreshExplorer]);

  // Default tab (stable for SSR)
  const defaultTabs: EditorTab[] = [
    {
      id: 1,
      name: "Untitled 1",
      content: '-- Enjoy using my UI ~ 3itx\n',
    },
  ];
  const nextId = useRef(2);
  const [tabs, setTabs] = useState<EditorTab[]>(defaultTabs);
  const [activeTabId, setActiveTabId] = useState(1);
  const hydrated = useRef(false);

  // Restore cached tabs on mount (client-only, after hydration)
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const cached = loadCachedTabs();
    if (cached && cached.tabs.length > 0) {
      setTabs(cached.tabs);
      setActiveTabId(cached.activeId);
      nextId.current = Math.max(...cached.tabs.map(t => t.id)) + 1;
    }
  }, []);

  // Persist tabs to localStorage
  useEffect(() => {
    if (!hydrated.current) return;
    saveCachedTabs(tabs, activeTabId);
  }, [tabs, activeTabId]);

  // Console
  const lineId = useRef(0);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(220);

  // Settings
  const [settings, setSettings] = useState<ExecutorSettings>(loadSettings);
  const settingsRef = useRef<ExecutorSettings>(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Apply theme to <html> element
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "default") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", settings.theme);
    }
    // Update body background to match theme
    const bg = getComputedStyle(root).getPropertyValue("--background").trim();
    document.body.style.background = bg;
  }, [settings.theme]);

  // Account Manager
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [selectedPids, setSelectedPids] = useState<Set<number>>(new Set());

  // Refs for stable WS callback (avoids stale closures)
  const clientsRef = useRef<ClientInfo[]>([]);
  const selectedPidsRef = useRef<Set<number>>(new Set());
  useEffect(() => { clientsRef.current = clients; }, [clients]);
  useEffect(() => { selectedPidsRef.current = selectedPids; }, [selectedPids]);

  // Register global callback here (parent never unmounts → selection persists across tab switches)
  // Track previous jobIds to detect new joins
  const prevJobIds = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    (window as any).__onClientsUpdate = (clientsData: ClientInfo[]) => {
      const incoming = Array.isArray(clientsData) ? clientsData : [];
      setClients(incoming);
      // Auto-select any NEW client PIDs
      const currentPids = new Set(clientsRef.current.map(c => c.pid));
      const updated = new Set(selectedPidsRef.current);
      let changed = false;
      for (const c of incoming) {
        if (!currentPids.has(c.pid) && !updated.has(c.pid)) {
          updated.add(c.pid);
          changed = true;
        }
      }
      if (changed) setSelectedPids(updated);

      // Detect job changes → trigger join notification
      if (settingsRef.current.joinNotifications) {
        for (const c of incoming) {
          try {
            if (c.status === "injecting" || c.status === "disconnected") continue;
            if (!c.jobId || !c.placeId || c.pidOnly) continue;
            const prevJob = prevJobIds.current.get(c.pid);
            if (prevJob !== c.jobId) {
              prevJobIds.current.set(c.pid, c.jobId);
              // New game join detected — show notification
              fsBridge.showJoinNotification({
                avatarUrl: c.avatarUrl || `https://www.roblox.com/headshot-thumbnail/image?userId=${c.userId}&width=150&height=150&format=png`,
                displayName: c.displayName,
                username: c.username,
                jobId: c.jobId,
                robloxPid: c.pid,
                userId: c.userId,
                duration: settingsRef.current.joinNotificationDuration || 5,
              });
            }
          } catch { /* ignore per-client errors */ }
        }
      } // end joinNotifications check
    };
    return () => { delete (window as any).__onClientsUpdate; };
  }, []);

  // Toast
  const { toasts, show: showToast } = useToast();

  // -- Console helpers
  const log = useCallback(
    (message: string, type: ConsoleLine["type"] = "", client?: string) => {
      setConsoleLines((prev) => [
        ...prev,
        { id: lineId.current++, timestamp: timestamp(), message, type, client },
      ]);
    },
    []
  );

  // Register global callback for remote logs (print/warn/error from Roblox instances)
  useEffect(() => {
    (window as any).__onRemoteLog = (clientName: string, _pid: number, level: string, message: string) => {
      const typeMap: Record<string, ConsoleLine["type"]> = {
        info: "info", warning: "warning", error: "error", print: "info", warn: "warning"
      };
      setConsoleLines((prev) => [
        ...prev,
        { id: lineId.current++, timestamp: timestamp(), message, type: typeMap[level] || "info", client: clientName },
      ]);
    };
    return () => { delete (window as any).__onRemoteLog; };
  }, []);

  // Register global callback for LSP data (game tree from Roblox instances)
  useEffect(() => {
    (window as any).__onLspData = (pid: number, rawJson: string) => {
      try {
        const data = JSON.parse(rawJson);
        const type = data?.type;
        if (type === "lsp_init") lspStore.handleLspInit(pid, data);
        else if (type === "lsp_add") lspStore.handleLspAdd(pid, data);
        else if (type === "lsp_remove") lspStore.handleLspRemove(pid, data);
      } catch { }
    };
    return () => { delete (window as any).__onLspData; };
  }, []);

  // Toggle console redirect on all connected instances when setting changes
  useEffect(() => {
    fsBridge.setConsoleRedirect(settings.redirectConsole);
  }, [settings.redirectConsole]);

  // Toggle LSP Connect on all connected instances when setting changes
  useEffect(() => {
    fsBridge.setLSPConnect(settings.lspConnect);
  }, [settings.lspConnect]);

  // Toggle FPS unlock on all connected instances when setting changes
  useEffect(() => {
    fsBridge.setUnlockFPS(settings.unlockFPS);
  }, [settings.unlockFPS]);

  // Toggle always-on-top window mode
  useEffect(() => {
    fsBridge.setTopMost(settings.topMost);
  }, [settings.topMost]);

  // -- Tab actions
  const switchTab = useCallback((id: number) => setActiveTabId(id), []);

  // Deduplicate tab names: "untitled.lua" → "untitled.lua 2" etc.
  const uniqueTabName = useCallback((baseName: string, currentTabs: EditorTab[]) => {
    const names = new Set(currentTabs.map(t => t.name));
    if (!names.has(baseName)) return baseName;
    let i = 2;
    while (names.has(`${baseName} ${i}`)) i++;
    return `${baseName} ${i}`;
  }, []);

  const addTab = useCallback(() => {
    const id = nextId.current++;
    setTabs((prev) => {
      // Find the lowest unused "Untitled N" number
      const usedNumbers = new Set(
        prev.map(t => {
          const m = t.name.match(/^Untitled (\d+)$/);
          return m ? parseInt(m[1]) : 0;
        })
      );
      let n = 1;
      while (usedNumbers.has(n)) n++;
      return [...prev, { id, name: `Untitled ${n}`, content: "" }];
    });
    setActiveTabId(id);
  }, []);

  const renameTab = useCallback((id: number, newName: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, name: newName } : t)));
  }, []);

  const closeTab = useCallback(
    (id: number) => {
      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== id);
        if (filtered.length === 0) {
          const newId = nextId.current++;
          setActiveTabId(newId);
          return [{ id: newId, name: "Untitled 1", content: "" }];
        }
        if (activeTabId === id) {
          const idx = prev.findIndex((t) => t.id === id);
          const next = filtered[Math.min(idx, filtered.length - 1)];
          setActiveTabId(next.id);
        }
        return filtered;
      });
    },
    [activeTabId]
  );

  const changeContent = useCallback((id: number, content: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)));
  }, []);

  // -- Explorer file click -> open in tab (instant — loads content in background)
  const openExplorerFile = useCallback((node: ExplorerNode, root: "scripts" | "autoexec") => {
    if (node.type !== "file") return;
    const id = nextId.current++;
    // Open tab instantly with whatever content we have (may be empty for new files)
    setTabs((prev) => {
      const name = uniqueTabName(node.name, prev);
      return [...prev, { id, name, content: node.content ?? "" }];
    });
    setActiveTabId(id);
    setPanel("editor");
    // Load real content from disk in background (fire-and-forget)
    fsBridge.readFile(root, node.name).then((diskContent) => {
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content: diskContent } : t)));
    }).catch(() => { /* file may not exist on disk yet */ });
  }, [uniqueTabName]);

  // -- Editor actions
  const execute = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || !tab.content.trim()) {
      showToast("No script to execute", "error");
      return;
    }

    // Only execute on explicitly selected clients
    const pids = Array.from(selectedPids);

    if (pids.length === 0) {
      showToast("No accounts selected", "error");
      return;
    }

    if (settings.debugMode) log(`Executing "${tab.name}"...`, "info");
    fsBridge.executeOnClients(pids, tab.content);
    if (settings.debugMode) log(`Script sent to ${pids.length} client(s): PID ${pids.join(", ")}`, "success");

    showToast("Script executed", "success");
  }, [tabs, activeTabId, log, showToast, selectedPids, settings.debugMode]);

  const clear = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, content: "" } : t))
    );
    showToast("Editor cleared", "info");
  }, [activeTabId, showToast]);

  const openFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".lua,.luau,.txt";
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      let lastId = 0;
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const id = nextId.current++;
          lastId = id;
          setTabs((prev) => [
            ...prev,
            { id, name: file.name, content: reader.result as string },
          ]);
          setActiveTabId(id);
        };
        reader.readAsText(file);
      });
      showToast(
        files.length === 1
          ? `Opened "${files[0].name}"`
          : `Opened ${files.length} files`,
        "success"
      );
    };
    input.click();
  }, [showToast]);

  const saveFile = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const fileName = tab.name.endsWith(".lua") || tab.name.endsWith(".luau") ? tab.name : tab.name + ".lua";
    try {
      await fsBridge.writeFile("scripts", fileName, tab.content);
      showToast(`Saved "${fileName}"`, "success");
      refreshExplorer();
    } catch {
      showToast("Failed to save file", "error");
    }
  }, [tabs, activeTabId, showToast, refreshExplorer]);

  const launch = useCallback(() => {
    log("Launching Roblox...", "info");
    fsBridge.launchRoblox().then(ok => {
      if (ok) {
        log("Roblox launched.", "success");
        showToast("Roblox launched", "success");
      } else {
        log("Failed to launch Roblox.", "error");
        showToast("Failed to launch Roblox", "error");
      }
    });
  }, [log, showToast]);

  // -- Settings
  const updateSettings = useCallback(
    (newSettings: ExecutorSettings) => {
      const prevAutoExec = settings.autoExec;
      setSettings(newSettings);
      try {
        localStorage.setItem("3itx-settings", JSON.stringify(newSettings));
      } catch { }
      // Sync to Synapse Z autoexec when autoExec toggle changes
      if (newSettings.autoExec !== prevAutoExec) {
        fsBridge.syncAutoExec(newSettings.autoExec);
      }
    },
    [settings.autoExec]
  );

  // -- Script Hub execute
  const loadScript = useCallback(
    (title: string, content: string) => {
      const pids = Array.from(selectedPids);
      if (pids.length === 0) {
        showToast("No accounts selected", "error");
        return;
      }
      fsBridge.executeOnClients(pids, content);
      showToast(`Executing "${title}"`, "success");
    },
    [selectedPids, showToast]
  );

  // -- Script Hub insert to editor
  const insertToEditor = useCallback(
    (title: string, content: string) => {
      const newId = nextId.current++;
      const newTab = { id: newId, name: title || `Hub Script`, content };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newId);
      setPanel("editor");
      showToast(`Inserted "${title}" to editor`, "info");
    },
    [showToast]
  );

  // -- Initial log on mount
  useEffect(() => {
    log("System initialized.", "success");
    log("Welcome to 3itx UI.", "info");
  }, [log]);

  // Active tab name for status bar
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <>
      <div className="flex flex-col w-full h-screen">
        <TitleBar />

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <Sidebar active={panel} onSwitch={setPanel} />

          {/* Main content area */}
          <div className="flex-1 flex overflow-hidden">

            {/* Explorer (visible when on editor panel) */}
            {panel === "editor" && (
              <ExplorerPanel
                scriptsTree={scriptsTree}
                autoExecTree={autoExecTree}
                onScriptsChange={setScriptsTree}
                onAutoExecChange={setAutoExecTree}
                activeFile={activeTab?.name || null}
                onFileClick={openExplorerFile}
                searchQuery={explorerSearch}
                onSearchChange={setExplorerSearch}
                onRefresh={refreshExplorer}
              />
            )}

            {/* Editor + Console bottom split */}
            {panel === "editor" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <EditorPanel
                  tabs={tabs}
                  activeTabId={activeTabId}
                  onSwitchTab={switchTab}
                  onCloseTab={closeTab}
                  onAddTab={addTab}
                  onRenameTab={renameTab}
                  onContentChange={changeContent}
                  onExecute={execute}
                  onClear={clear}
                  onOpen={openFile}
                  onSave={saveFile}
                  onLaunch={launch}
                  fontSize={settings.editorFont}
                  wordWrap={settings.wordWrap}
                  lineNumbers={settings.lineNumbers}
                  bracketPairColorization={settings.bracketPairColorization}
                />
                <ConsolePanel
                  lines={consoleLines}
                  collapsed={consoleCollapsed}
                  onToggleCollapse={() => setConsoleCollapsed(!consoleCollapsed)}
                  height={consoleHeight}
                  onHeightChange={setConsoleHeight}
                  onClear={() => {
                    setConsoleLines([]);
                    showToast("Console cleared", "info");
                  }}
                />
              </div>
            )}

            {/* Settings */}
            {panel === "settings" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <SettingsPanel settings={settings} onChange={updateSettings} />
              </div>
            )}

            {/* Script Hub */}
            {panel === "scripthub" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <ScriptHubPanel onLoad={loadScript} onInsertToEditor={insertToEditor} />
              </div>
            )}

            {/* Account Manager */}
            {panel === "accounts" && (
              <AccountManagerPanel
                clients={clients}
                onClientsChange={setClients}
                selectedPids={selectedPids}
                onSelectedPidsChange={setSelectedPids}
              />
            )}

            {/* Regions */}
            {panel === "regions" && (
              <RegionsPanel
                clients={clients}
                selectedPids={selectedPids}
              />
            )}
          </div>
        </div>

        <StatusBar connected={clients.length > 0} clientCount={clients.length} />
      </div>

      <ToastContainer toasts={toasts} />
    </>
  );
}
