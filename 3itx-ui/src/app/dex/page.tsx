"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import DexExplorerPanel from "@/components/dex-explorer-panel";

function DexContent() {
    const params = useSearchParams();
    const pid = parseInt(params.get("pid") || "0");
    const username = params.get("username") || "Unknown";

    if (!pid) {
        return (
            <div className="w-full h-screen flex items-center justify-center bg-[#0a0a0b] text-muted-foreground/40 text-[11px]">
                Missing PID parameter
            </div>
        );
    }

    return (
        <div className="w-full h-screen flex flex-col bg-[#0a0a0b] overflow-hidden">
            <DexExplorerPanel
                pid={pid}
                username={username}
                onClose={() => {
                    // Signal the WPF window to close via WebView2 bridge
                    try {
                        (window as any).chrome?.webview?.postMessage(JSON.stringify({ type: "closeDex" }));
                    } catch { /* ignore */ }
                }}
            />
        </div>
    );
}

export default function DexPage() {
    return (
        <Suspense fallback={
            <div className="w-full h-screen flex items-center justify-center bg-[#0a0a0b]">
                <div className="w-4 h-4 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
            </div>
        }>
            <DexContent />
        </Suspense>
    );
}
