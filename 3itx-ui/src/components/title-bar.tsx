"use client";

import { Minus, Square, X } from "lucide-react";
import Image from "next/image";

declare global {
    interface Window {
        __3itx?: {
            minimize: () => void;
            maximize: () => void;
            close: () => void;
            drag: () => void;
        };
        chrome?: {
            webview?: {
                postMessage: (msg: string) => void;
            };
        };
    }
}

export default function TitleBar() {
    const handleMinimize = () => window.__3itx?.minimize?.();
    const handleMaximize = () => window.__3itx?.maximize?.();
    const handleClose = () => window.__3itx?.close?.();

    const handleTitleBarMouseDown = (e: React.MouseEvent) => {
        // Only drag on left click, and not when clicking buttons
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest("button")) return;

        // Double-click to maximize
        if (e.detail === 2) {
            handleMaximize();
            return;
        }

        window.__3itx?.drag?.();
    };

    return (
        <div
            onMouseDown={handleTitleBarMouseDown}
            className="glass-heavy flex items-center h-[38px] border-b border-border px-3 select-none shrink-0 cursor-default"
            suppressHydrationWarning
        >
            {/* Logo */}
            <div className="flex items-center gap-2 shrink-0">
                <Image src="/logo.svg" alt="Logo" width={18} height={18} className="opacity-70" />
            </div>

            {/* Center label */}
            <div className="flex-1 flex items-center justify-center pointer-events-none">
                <span className="text-[11px] text-muted-foreground tracking-wide">
                    Synapse Z
                    <span className="mx-1.5 text-white/40">·</span>
                    <span className="font-semibold text-foreground/80">3itx</span>
                </span>
            </div>

            {/* Window Controls — no-drag region */}
            <div className="flex gap-0.5 shrink-0">
                <button
                    onClick={handleMinimize}
                    className="w-[34px] h-[38px] flex items-center justify-center text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
                >
                    <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={handleMaximize}
                    className="w-[34px] h-[38px] flex items-center justify-center text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
                >
                    <Square className="w-3 h-3" />
                </button>
                <button
                    onClick={handleClose}
                    className="w-[34px] h-[38px] flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
