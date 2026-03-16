"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
    Search,
    Filter,
    Trash2,
    XCircle,
    AlertTriangle,
    Info,
    CheckCircle2,
    CircleDot,
    X,
    ArrowLeftToLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ConsoleLine {
    id: number;
    timestamp: string;
    message: string;
    type: "" | "info" | "success" | "warning" | "error";
    client?: string;
}

const typeColors: Record<string, string> = {
    "": "text-muted-foreground",
    info: "text-blue-400",
    success: "text-emerald-400",
    warning: "text-amber-400",
    error: "text-red-400",
};

const typeIcons: Record<string, React.ReactNode> = {
    "": <CircleDot className="w-3 h-3" />,
    info: <Info className="w-3 h-3" />,
    success: <CheckCircle2 className="w-3 h-3" />,
    warning: <AlertTriangle className="w-3 h-3" />,
    error: <XCircle className="w-3 h-3" />,
};

type FilterType = "all" | "info" | "success" | "warning" | "error" | "log";

export default function ConsolePage() {
    const [lines, setLines] = useState<ConsoleLine[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [showSearch, setShowSearch] = useState(false);
    const [filter, setFilter] = useState<FilterType>("all");
    const [showFilter, setShowFilter] = useState(false);
    const [clientFilter, setClientFilter] = useState<string>("all");
    const scrollRef = useRef<HTMLDivElement>(null);

    // Expose global functions for C# to inject lines via ExecuteScriptAsync
    useEffect(() => {
        (window as any).__addConsoleLine = (line: ConsoleLine) => {
            setLines((prev) => [...prev, line]);
        };
        (window as any).__setConsoleLines = (newLines: ConsoleLine[]) => {
            setLines(newLines);
        };
        (window as any).__clearConsole = () => {
            setLines([]);
        };
        // Signal to C# that we're ready to receive lines
        (window as any).__consoleReady = true;
        return () => {
            delete (window as any).__addConsoleLine;
            delete (window as any).__setConsoleLines;
            delete (window as any).__clearConsole;
            delete (window as any).__consoleReady;
        };
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [lines]);

    const clientNames = Array.from(new Set(lines.filter((l) => l.client).map((l) => l.client!)));

    const filtered = lines.filter((l) => {
        if (filter === "log" && !l.client) return false;
        if (filter !== "all" && filter !== "log" && l.type !== filter) return false;
        if (clientFilter !== "all" && l.client !== clientFilter) return false;
        if (searchQuery && !l.message.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    const counts = {
        error: lines.filter((l) => l.type === "error").length,
        warning: lines.filter((l) => l.type === "warning").length,
    };

    const handleClear = useCallback(() => {
        setLines([]);
        // Tell main window to clear too
        try {
            (window as any).chrome?.webview?.postMessage(JSON.stringify({ action: "consoleClear" }));
        } catch {}
    }, []);

    const handleDockBack = useCallback(() => {
        // Tell main window to re-dock
        try {
            (window as any).chrome?.webview?.postMessage(JSON.stringify({ type: "closeConsole" }));
        } catch {}
    }, []);

    return (
        <div className="flex flex-col h-screen bg-[#0a0a0c] text-foreground select-none">
            {/* Header */}
            <div className="flex items-center h-[32px] px-3 gap-2 shrink-0 border-b border-white/[0.06] bg-[#0c0c0e]">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Terminal
                </span>
                <span className="text-[9px] h-4 px-1.5 bg-white/5 text-muted-foreground rounded-sm flex items-center">
                    {filtered.length}
                </span>

                {counts.error > 0 && (
                    <button
                        onClick={() => setFilter(filter === "error" ? "all" : "error")}
                        className={cn(
                            "flex items-center gap-0.5 h-4 px-1 rounded text-[9px] transition-colors",
                            filter === "error" ? "bg-red-500/20 text-red-400" : "text-red-400/60 hover:bg-red-500/10"
                        )}
                    >
                        <XCircle className="w-2.5 h-2.5" /> {counts.error}
                    </button>
                )}
                {counts.warning > 0 && (
                    <button
                        onClick={() => setFilter(filter === "warning" ? "all" : "warning")}
                        className={cn(
                            "flex items-center gap-0.5 h-4 px-1 rounded text-[9px] transition-colors",
                            filter === "warning" ? "bg-amber-500/20 text-amber-400" : "text-amber-400/60 hover:bg-amber-500/10"
                        )}
                    >
                        <AlertTriangle className="w-2.5 h-2.5" /> {counts.warning}
                    </button>
                )}

                <div className="flex-1" />

                {/* Search input inline */}
                {showSearch && (
                    <div className="flex items-center gap-1.5 h-[22px] px-2 bg-white/[0.04] rounded-md border border-white/[0.06]">
                        <Search className="w-3 h-3 text-muted-foreground" />
                        <input
                            autoFocus
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-[120px] bg-transparent text-[10px] text-foreground placeholder:text-muted-foreground border-none outline-none"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery("")} className="text-muted-foreground hover:text-foreground">
                                <X className="w-2.5 h-2.5" />
                            </button>
                        )}
                    </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={() => setShowSearch(!showSearch)}
                        className={cn(
                            "w-6 h-6 flex items-center justify-center rounded transition-colors",
                            showSearch ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                        )}
                    >
                        <Search className="w-3 h-3" />
                    </button>
                    <button
                        onClick={() => setShowFilter(!showFilter)}
                        className={cn(
                            "w-6 h-6 flex items-center justify-center rounded transition-colors",
                            showFilter ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                        )}
                    >
                        <Filter className="w-3 h-3" />
                    </button>
                    <button onClick={handleClear} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
                        <Trash2 className="w-3 h-3" />
                    </button>
                    <button
                        onClick={handleDockBack}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                        title="Dock back to main window"
                    >
                        <ArrowLeftToLine className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {/* Filter bar */}
            {showFilter && (
                <div className="flex items-center h-[24px] px-3 gap-1 border-b border-white/[0.04] shrink-0">
                    {(["all", "log", "info", "success", "warning", "error"] as FilterType[]).map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={cn(
                                "h-[18px] px-1.5 rounded text-[9px] font-medium capitalize transition-colors",
                                filter === f ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                            )}
                        >
                            {f}
                        </button>
                    ))}
                    {clientNames.length > 0 && (
                        <>
                            <div className="w-px h-3 bg-white/10 mx-1" />
                            <select
                                value={clientFilter}
                                onChange={(e) => setClientFilter(e.target.value)}
                                className="h-[18px] px-1 rounded text-[9px] font-medium bg-white/5 text-muted-foreground border-0 outline-none cursor-pointer hover:bg-white/10 transition-colors"
                            >
                                <option value="all">All Accounts</option>
                                {clientNames.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </>
                    )}
                </div>
            )}

            {/* Output */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
                <div className="p-3 space-y-0.5 font-mono text-xs leading-5">
                    {filtered.length === 0 && (
                        <p className="text-center text-muted-foreground/40 py-8">
                            {lines.length === 0 ? (
                                <>
                                    No terminals available
                                    <br />
                                    <span className="text-[10px]">Waiting for console output...</span>
                                </>
                            ) : (
                                "No matching results"
                            )}
                        </p>
                    )}
                    {filtered.map((line, idx) => (
                        <div key={idx} className="flex gap-2 items-start hover:bg-white/[0.02] px-1 rounded transition-colors">
                            <span className="text-muted-foreground/30 shrink-0 pt-0.5">
                                {typeIcons[line.type]}
                            </span>
                            <span className="text-muted-foreground/40 shrink-0">
                                {line.timestamp}
                            </span>
                            {line.client && (
                                <span className="text-[9px] bg-white/5 text-muted-foreground px-1 rounded shrink-0">
                                    {line.client}
                                </span>
                            )}
                            <span className={cn(typeColors[line.type] || typeColors[""], "break-all")}>
                                {line.message}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
