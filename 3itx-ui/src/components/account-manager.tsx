"use client";

import { useState, useCallback } from "react";
import { Users, Monitor, Gamepad2, RefreshCw, X, Check } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import * as fsBridge from "@/lib/fs-bridge";

/* eslint-disable @next/next/no-img-element */

export interface ClientInfo {
    id: string;
    pid: number;
    userId: number;
    username: string;
    displayName: string;
    placeId: number;
    placeName: string;
    jobId: string;
    status: "connected" | "injecting" | "disconnected" | "menu";
    avatarUrl?: string;
}

interface AccountManagerProps {
    clients: ClientInfo[];
    onClientsChange: (clients: ClientInfo[]) => void;
    selectedPids: Set<number>;
    onSelectedPidsChange: (pids: Set<number>) => void;
}

export default function AccountManagerPanel({
    clients,
    onClientsChange,
    selectedPids,
    onSelectedPidsChange,
}: AccountManagerProps) {
    const [refreshing, setRefreshing] = useState(false);

    const togglePid = useCallback((pid: number) => {
        const next = new Set(selectedPids);
        if (next.has(pid)) next.delete(pid);
        else next.add(pid);
        onSelectedPidsChange(next);
    }, [selectedPids, onSelectedPidsChange]);

    const selectAll = useCallback(() => {
        onSelectedPidsChange(new Set(clients.map(c => c.pid)));
    }, [clients, onSelectedPidsChange]);

    const deselectAll = useCallback(() => {
        onSelectedPidsChange(new Set());
    }, [onSelectedPidsChange]);

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        const data = await fsBridge.refreshClients();
        if (Array.isArray(data)) onClientsChange(data);
        setTimeout(() => setRefreshing(false), 500);
    }, [onClientsChange]);

    const handleKill = useCallback(async (pid: number) => {
        await fsBridge.killClient(pid);
        onClientsChange(clients.filter(c => c.pid !== pid));
        selectedPids.delete(pid);
        onSelectedPidsChange(new Set(selectedPids));
    }, [clients, selectedPids, onClientsChange, onSelectedPidsChange]);

    const allSelected = clients.length > 0 && clients.every(c => selectedPids.has(c.pid));

    const statusLabel = (s: string) => {
        if (s === "connected") return "In Game";
        if (s === "menu") return "In Menu";
        if (s === "injecting") return "Injecting";
        return "Offline";
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden animate-panel-in">
            {/* Checkbox animation keyframes */}
            <style>{`
                @keyframes checkmark-pop {
                    0% { transform: scale(0) rotate(-20deg); opacity: 0; }
                    60% { transform: scale(1.2) rotate(0deg); opacity: 1; }
                    100% { transform: scale(1) rotate(0deg); opacity: 1; }
                }
                @keyframes checkbox-fill {
                    0% { transform: scale(0.8); opacity: 0.5; }
                    50% { transform: scale(1.05); }
                    100% { transform: scale(1); opacity: 1; }
                }
                .check-animate {
                    animation: checkmark-pop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                }
                .checkbox-animate {
                    animation: checkbox-fill 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                }
            `}</style>

            {/* Header */}
            <div className="flex items-center h-[36px] px-3 border-b border-white/[0.06] shrink-0">
                <Users className="w-3.5 h-3.5 text-muted-foreground mr-2" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Account Manager
                </span>
                <div className="flex-1" />
                {clients.length > 0 && (
                    <button
                        onClick={allSelected ? deselectAll : selectAll}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors mr-0.5"
                        title={allSelected ? "Deselect All" : "Select All"}
                    >
                        <Check className="w-3 h-3" />
                    </button>
                )}
                <button
                    onClick={handleRefresh}
                    className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                    title="Refresh"
                >
                    <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />
                </button>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                    {/* Status banner */}
                    <div className={cn(
                        "rounded-lg border p-2.5 mb-3 flex items-center gap-2",
                        clients.length > 0
                            ? "border-emerald-500/20 bg-emerald-500/[0.05]"
                            : "border-white/[0.06] bg-white/[0.02]"
                    )}>
                        <div className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            clients.length > 0 ? "bg-emerald-400" : "bg-muted-foreground/30"
                        )} />
                        <span className="text-[10px] text-muted-foreground">
                            {clients.length > 0
                                ? `Connected — ${clients.length} account${clients.length !== 1 ? "s" : ""}`
                                : "Disconnected — no clients connected"
                            }
                        </span>
                    </div>

                    {/* Client list */}
                    {clients.length === 0 ? (
                        <div className="text-center py-10">
                            <Monitor className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                            <p className="text-[11px] text-muted-foreground/50 mb-1">No clients connected</p>
                            <p className="text-[9px] text-muted-foreground/30">
                                Launch Roblox to see accounts here
                            </p>
                        </div>
                    ) : (
                        clients.map((client) => {
                            const isSelected = selectedPids.has(client.pid);
                            return (
                                <div
                                    key={client.id}
                                    className={cn(
                                        "group relative rounded-lg border p-2.5 transition-all duration-200 cursor-pointer",
                                        isSelected
                                            ? "border-white/[0.15] bg-white/[0.06] shadow-[0_0_12px_rgba(255,255,255,0.03)]"
                                            : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1]"
                                    )}
                                    onClick={() => togglePid(client.pid)}
                                >
                                    <div className="flex items-center gap-2.5">
                                        {/* Checkbox with animated checkmark */}
                                        <div className={cn(
                                            "shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                            isSelected
                                                ? "bg-white border-white checkbox-animate"
                                                : "border-white/[0.15] hover:border-white/[0.3]"
                                        )}>
                                            {isSelected && (
                                                <Check className="w-3 h-3 text-black check-animate" strokeWidth={3} />
                                            )}
                                        </div>

                                        {/* Avatar */}
                                        <div className="w-8 h-8 shrink-0 rounded-full overflow-hidden bg-white/[0.06]">
                                            {client.avatarUrl ? (
                                                <img
                                                    src={client.avatarUrl}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                    draggable={false}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <Users className="w-3 h-3 text-muted-foreground/30" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                {/* Status dot */}
                                                <div className={cn(
                                                    "w-1.5 h-1.5 rounded-full shrink-0",
                                                    client.status === "connected" ? "bg-emerald-400" :
                                                        client.status === "menu" ? "bg-blue-400" :
                                                            client.status === "injecting" ? "bg-amber-400 animate-pulse" :
                                                                "bg-red-400"
                                                )} />
                                                <span className="text-[11px] font-medium text-foreground truncate">
                                                    {client.displayName}
                                                </span>
                                                <span className="text-[9px] text-muted-foreground/60">
                                                    @{client.username}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <div className="flex items-center gap-1">
                                                    <Gamepad2 className="w-2.5 h-2.5 text-muted-foreground/40" />
                                                    <span className="text-[9px] text-muted-foreground/50 truncate max-w-[100px]">
                                                        {client.placeName || `Place ${client.placeId}`}
                                                    </span>
                                                </div>
                                                {/* Status label */}
                                                <span className={cn(
                                                    "text-[8px] px-1 py-px rounded font-medium",
                                                    client.status === "connected" ? "bg-emerald-500/10 text-emerald-400/70" :
                                                        client.status === "menu" ? "bg-blue-500/10 text-blue-400/70" :
                                                            "bg-white/[0.06] text-muted-foreground/40"
                                                )}>
                                                    {statusLabel(client.status)}
                                                </span>
                                                {/* PID Badge */}
                                                <span className="text-[8px] px-1 py-px rounded bg-white/[0.06] text-muted-foreground/40 font-mono">
                                                    PID {client.pid}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Kill button */}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleKill(client.pid);
                                            }}
                                            className="shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-all"
                                            title={`Kill PID ${client.pid}`}
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
