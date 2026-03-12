"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
    label: string;
    icon?: React.ReactNode;
    action: () => void;
    danger?: boolean;
    separator?: boolean;
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const escHandler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", handler);
        document.addEventListener("keydown", escHandler);
        return () => {
            document.removeEventListener("mousedown", handler);
            document.removeEventListener("keydown", escHandler);
        };
    }, [onClose]);

    // Clamp position so it doesn't overflow viewport
    const style = {
        top: Math.min(y, window.innerHeight - items.length * 32 - 16),
        left: Math.min(x, window.innerWidth - 180),
    };

    return (
        <div
            ref={ref}
            className="fixed z-[9999] w-[176px] py-1 rounded-lg bg-[#141418] border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5)] animate-fade-slide-in"
            style={style}
        >
            {items.map((item, i) =>
                item.separator ? (
                    <div key={i} className="h-px bg-white/[0.06] my-1 mx-2" />
                ) : (
                    <button
                        key={i}
                        onClick={() => {
                            item.action();
                            onClose();
                        }}
                        className={cn(
                            "flex items-center gap-2 w-full px-3 py-1.5 text-[11px] transition-colors text-left",
                            item.danger
                                ? "text-red-400 hover:bg-red-500/10"
                                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                        )}
                    >
                        {item.icon && <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">{item.icon}</span>}
                        <span>{item.label}</span>
                    </button>
                )
            )}
        </div>
    );
}
