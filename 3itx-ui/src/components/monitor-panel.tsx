"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import * as fsBridge from "@/lib/fs-bridge";

/* eslint-disable @next/next/no-img-element */

interface MonitorPanelProps {
    pid: number;
    username: string;
    onClose: () => void;
}

export default function MonitorPanel({ pid, username, onClose }: MonitorPanelProps) {
    const [image, setImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pos, setPos] = useState({ x: 80, y: 80 });
    const [size, setSize] = useState({ w: 420, h: 280 });
    const [minimized, setMinimized] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
    const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const capture = useCallback(async () => {
        try {
            const img = await fsBridge.captureWindow(pid);
            if (img) {
                setImage(img);
                setError(null);
            } else {
                setError("Capture failed");
            }
        } catch {
            setError("Connection error");
        } finally {
            setLoading(false);
        }
    }, [pid]);

    // Start periodic capture
    useEffect(() => {
        capture();
        intervalRef.current = setInterval(capture, 500);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [capture]);

    // Drag handlers
    const onDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y };

        const onMove = (ev: MouseEvent) => {
            if (!dragRef.current) return;
            const dx = ev.clientX - dragRef.current.startX;
            const dy = ev.clientY - dragRef.current.startY;
            setPos({ x: dragRef.current.startPosX + dx, y: dragRef.current.startPosY + dy });
        };
        const onUp = () => {
            dragRef.current = null;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, [pos]);

    // Resize handlers
    const onResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: size.w, startH: size.h };

        const onMove = (ev: MouseEvent) => {
            if (!resizeRef.current) return;
            const dw = ev.clientX - resizeRef.current.startX;
            const dh = ev.clientY - resizeRef.current.startY;
            setSize({
                w: Math.max(240, resizeRef.current.startW + dw),
                h: Math.max(160, resizeRef.current.startH + dh),
            });
        };
        const onUp = () => {
            resizeRef.current = null;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, [size]);

    return (
        <div
            ref={panelRef}
            className="fixed z-[9999] flex flex-col"
            style={{
                left: pos.x,
                top: pos.y,
                width: size.w,
                height: minimized ? "auto" : size.h,
                boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)",
                borderRadius: 10,
                overflow: "hidden",
            }}
        >
            {/* Title bar — draggable */}
            <div
                className="flex items-center gap-2 px-3 py-1.5 cursor-move select-none shrink-0"
                style={{ background: "rgba(12,12,14,0.95)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                onMouseDown={onDragStart}
            >
                <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-[10px] font-medium text-muted-foreground truncate flex-1">
                    Monitor — {username} (PID {pid})
                </span>
                <button
                    onClick={() => { capture(); }}
                    className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-white/5 transition-colors"
                    title="Refresh now"
                >
                    <RefreshCw className="w-2.5 h-2.5" />
                </button>
                <button
                    onClick={() => setMinimized(!minimized)}
                    className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-white/5 transition-colors"
                    title={minimized ? "Expand" : "Minimize"}
                >
                    {minimized ? <Maximize2 className="w-2.5 h-2.5" /> : <Minimize2 className="w-2.5 h-2.5" />}
                </button>
                <button
                    onClick={onClose}
                    className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/50 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    title="Close monitor"
                >
                    <X className="w-2.5 h-2.5" />
                </button>
            </div>

            {/* Content area */}
            {!minimized && (
                <div className="flex-1 relative" style={{ background: "rgba(10,10,12,0.95)" }}>
                    {loading && !image && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex flex-col items-center gap-2">
                                <RefreshCw className="w-5 h-5 text-muted-foreground/30 animate-spin" />
                                <span className="text-[9px] text-muted-foreground/40">Capturing...</span>
                            </div>
                        </div>
                    )}
                    {error && !image && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[10px] text-red-400/60">{error}</span>
                        </div>
                    )}
                    {image && (
                        <img
                            src={image}
                            alt={`Monitor ${username}`}
                            className="w-full h-full object-contain"
                            draggable={false}
                        />
                    )}

                    {/* Resize handle */}
                    <div
                        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
                        onMouseDown={onResizeStart}
                        style={{
                            background: "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.15) 50%)",
                        }}
                    />
                </div>
            )}
        </div>
    );
}
