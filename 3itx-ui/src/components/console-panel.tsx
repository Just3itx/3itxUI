"use client";

import { useState, useRef, useEffect } from "react";
import {
    Search,
    Filter,
    Trash2,
    ChevronUp,
    ChevronDown,
    XCircle,
    AlertTriangle,
    Info,
    CheckCircle2,
    CircleDot,
    X,
    Ban,
    GripHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ConsoleLine {
    id: number;
    timestamp: string;
    message: string;
    type: "" | "info" | "success" | "warning" | "error";
    client?: string;
}

interface ConsolePanelProps {
    lines: ConsoleLine[];
    onClear: () => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
    height: number;
    onHeightChange: (h: number) => void;
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

export default function ConsolePanel({ lines, onClear, collapsed, onToggleCollapse, height, onHeightChange }: ConsolePanelProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [showSearch, setShowSearch] = useState(false);
    const [filter, setFilter] = useState<FilterType>("all");
    const [showFilter, setShowFilter] = useState(false);
    const [clientFilter, setClientFilter] = useState<string>("all");
    const scrollRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ startY: number; startH: number } | null>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [lines]);

    // Get unique client names for account filter
    const clientNames = Array.from(new Set(lines.filter(l => l.client).map(l => l.client!)));

    const filtered = lines.filter((l) => {
        if (filter === "log" && !l.client) return false; // Show only remote logs
        if (filter !== "all" && filter !== "log" && l.type !== filter) return false;
        if (clientFilter !== "all" && l.client !== clientFilter) return false;
        if (searchQuery && !l.message.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    const counts = {
        error: lines.filter((l) => l.type === "error").length,
        warning: lines.filter((l) => l.type === "warning").length,
    };

    const handleDragStart = (e: React.MouseEvent) => {
        e.preventDefault();
        if (collapsed) return;
        dragRef.current = { startY: e.clientY, startH: height };
        const onMove = (ev: MouseEvent) => {
            if (!dragRef.current) return;
            const dy = dragRef.current.startY - ev.clientY;
            onHeightChange(Math.max(80, Math.min(600, dragRef.current.startH + dy)));
        };
        const onUp = () => {
            dragRef.current = null;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    return (
        <div className={cn(
            "flex flex-col border-t border-white/[0.06] transition-all duration-300 ease-in-out bg-[#0a0a0c]",
            collapsed ? "h-[34px]" : ""
        )} style={collapsed ? undefined : { height }}>
            {/* Drag handle */}
            <div
                className="flex items-center justify-center h-[6px] cursor-ns-resize hover:bg-white/[0.04] transition-colors group"
                onMouseDown={handleDragStart}
                onDoubleClick={onToggleCollapse}
            >
                <div className="w-8 h-[3px] rounded-full bg-white/[0.08] group-hover:bg-white/[0.15] transition-colors" />
            </div>

            {/* Header */}
            <div className="flex items-center h-[28px] px-3 gap-2 shrink-0">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Terminals
                </span>
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5 bg-white/5 text-muted-foreground border-0">
                    {filtered.length}
                </Badge>

                {/* Error/Warning counts */}
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
                    <div className="flex items-center gap-1.5 h-[22px] px-2 bg-white/[0.04] rounded-md border border-white/[0.06] animate-fade-slide-in">
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
                    <button onClick={onClear} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
                        <Trash2 className="w-3 h-3" />
                    </button>
                    <button className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors" title="Terminate">
                        <Ban className="w-3 h-3" />
                    </button>
                    <button onClick={onToggleCollapse} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
                        {collapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    <button onClick={onToggleCollapse} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-white/5 transition-colors">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {/* Filter bar */}
            {showFilter && !collapsed && (
                <div className="flex items-center h-[24px] px-3 gap-1 border-t border-white/[0.04] shrink-0 animate-fade-slide-in">
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
                                {clientNames.map(name => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </>
                    )}
                </div>
            )}

            {/* Output */}
            {!collapsed && (
                <div ref={scrollRef} className="flex-1 overflow-y-auto">
                    <div className="p-3 space-y-0.5 font-mono text-xs leading-5">
                        {filtered.length === 0 && (
                            <p className="text-center text-muted-foreground/40 py-8">
                                {lines.length === 0 ? (
                                    <>
                                        No terminals available
                                        <br />
                                        <span className="text-[10px]">Terminals are created automatically when instances connect</span>
                                    </>
                                ) : (
                                    "No matching results"
                                )}
                            </p>
                        )}
                        {filtered.map((line) => (
                            <div key={line.id} className="flex gap-2 items-start animate-fade-slide-in hover:bg-white/[0.02] px-1 rounded transition-colors">
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
            )}
        </div>
    );
}
