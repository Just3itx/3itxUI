"use client";

import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusBarProps {
    connected: boolean;
    clientCount?: number;
}

export default function StatusBar({ connected, clientCount = 0 }: StatusBarProps) {
    const hasClients = clientCount > 0;
    return (
        <div className="glass-heavy flex items-center h-7 border-t border-border px-3 gap-4 shrink-0 select-none">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Circle
                    className={cn(
                        "w-1.5 h-1.5 fill-current",
                        hasClients
                            ? "text-emerald-400"
                            : "text-red-400"
                    )}
                />
                <span>
                    {hasClients
                        ? `Connected (${clientCount})`
                        : "Disconnected"
                    }
                </span>
            </div>
            <div className="flex-1" />
            <span className="text-[10px] text-muted-foreground">Spaces: 2</span>
            <span className="text-[10px] text-muted-foreground">UTF-8</span>
            <span className="text-[10px] text-muted-foreground">Luau</span>
        </div>
    );
}
