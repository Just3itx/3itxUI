"use client";

import {
    Code,
    Globe,
    KeyRound,
    LayoutGrid,
    Settings,
    Users,
} from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type PanelName = "editor" | "scripthub" | "settings" | "accounts" | "regions" | "synaccount";

interface SidebarProps {
    active: PanelName;
    onSwitch: (panel: PanelName) => void;
}

const TOP_ITEMS: { panel: PanelName; icon: React.ElementType; label: string }[] = [
    { panel: "editor", icon: Code, label: "Editor" },
    { panel: "scripthub", icon: LayoutGrid, label: "Script Hub" },
    { panel: "accounts", icon: Users, label: "Account Manager" },
    { panel: "regions", icon: Globe, label: "Regions" },
    { panel: "synaccount", icon: KeyRound, label: "Synapse Z Account" },
];

const BOTTOM_ITEMS: { panel: PanelName; icon: React.ElementType; label: string }[] = [
    { panel: "settings", icon: Settings, label: "Settings" },
];

export default function Sidebar({ active, onSwitch }: SidebarProps) {
    return (
        <nav className="w-[52px] bg-background border-r border-border flex flex-col items-center py-2 gap-1 shrink-0">
            {TOP_ITEMS.map(({ panel, icon: Icon, label }) => (
                <Tooltip key={panel}>
                    <TooltipTrigger
                        onClick={() => onSwitch(panel)}
                        className={cn(
                            "relative w-[38px] h-[38px] flex items-center justify-center rounded-lg transition-all duration-200 cursor-pointer",
                            active === panel
                                ? "text-foreground bg-white/[0.08]"
                                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                        )}
                    >
                        {/* Active left line indicator with glow */}
                        {active === panel && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-white rounded-full shadow-[0_0_8px_2px_rgba(255,255,255,0.35),0_0_16px_4px_rgba(255,255,255,0.15)] animate-sidebar-glow-in" />
                        )}
                        <Icon className="w-[18px] h-[18px]" />
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                        {label}
                    </TooltipContent>
                </Tooltip>
            ))}

            <div className="flex-1" />

            {BOTTOM_ITEMS.map(({ panel, icon: Icon, label }) => (
                <Tooltip key={panel}>
                    <TooltipTrigger
                        onClick={() => onSwitch(panel)}
                        className={cn(
                            "relative w-[38px] h-[38px] flex items-center justify-center rounded-lg transition-all duration-200 cursor-pointer",
                            active === panel
                                ? "text-foreground bg-white/[0.08]"
                                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                        )}
                    >
                        {active === panel && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-white rounded-full shadow-[0_0_8px_2px_rgba(255,255,255,0.35),0_0_16px_4px_rgba(255,255,255,0.15)] animate-sidebar-glow-in" />
                        )}
                        <Icon className="w-[18px] h-[18px]" />
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                        {label}
                    </TooltipContent>
                </Tooltip>
            ))}
        </nav>
    );
}
