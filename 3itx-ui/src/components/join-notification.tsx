"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Hash, X } from "lucide-react";

/* ─── Types ─── */
export interface JoinNotificationData {
    avatarUrl: string;
    displayName: string;
    username: string;
    jobId: string;
}

interface JoinNotification extends JoinNotificationData {
    id: number;
    createdAt: number;
}

/* ─── Single notification card ─── */
function NotificationCard({
    notification,
    duration,
    onDismiss,
}: {
    notification: JoinNotification;
    duration: number;
    onDismiss: (id: number) => void;
}) {
    const [progress, setProgress] = useState(100);
    const [visible, setVisible] = useState(false);
    const [exiting, setExiting] = useState(false);

    // Slide in
    useEffect(() => {
        const t = setTimeout(() => setVisible(true), 50);
        return () => clearTimeout(t);
    }, []);

    // Countdown timer
    useEffect(() => {
        const start = Date.now();
        const total = duration * 1000;
        const interval = setInterval(() => {
            const elapsed = Date.now() - start;
            const remaining = Math.max(0, 100 - (elapsed / total) * 100);
            setProgress(remaining);
            if (remaining <= 0) {
                clearInterval(interval);
                setExiting(true);
                setTimeout(() => onDismiss(notification.id), 300);
            }
        }, 50);
        return () => clearInterval(interval);
    }, [duration, notification.id, onDismiss]);

    const handleDismiss = () => {
        setExiting(true);
        setTimeout(() => onDismiss(notification.id), 300);
    };

    const n = notification;
    const shortJobId = n.jobId.length > 20 ? n.jobId.substring(0, 20) + "…" : n.jobId;
    const secondsLeft = Math.ceil((progress / 100) * duration);

    return (
        <div
            className={`
                relative overflow-hidden rounded-lg border border-white/[0.08]
                bg-[hsl(var(--card))]/95 backdrop-blur-xl shadow-2xl shadow-black/40
                w-[320px] transition-all duration-300 ease-out
                ${visible && !exiting ? "translate-x-0 opacity-100" : "translate-x-[120%] opacity-0"}
            `}
        >
            {/* Top section: avatar + name */}
            <div className="flex items-start gap-3 p-3 pb-2">
                <img
                    src={n.avatarUrl}
                    alt=""
                    className="w-10 h-10 rounded-full ring-1 ring-white/10 shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).src = `https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=png`; }}
                />
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-[11px] font-semibold text-white truncate">
                            {n.displayName}
                        </span>
                        <span className="text-[9px] text-muted-foreground/50 truncate">
                            @{n.username}
                        </span>
                    </div>
                    <span className="text-[10px] text-blue-400/80 font-medium">
                        joined a server
                    </span>
                </div>
                <button
                    onClick={handleDismiss}
                    className="p-0.5 rounded hover:bg-white/[0.06] text-muted-foreground/40 hover:text-white/60 transition-colors shrink-0"
                >
                    <X className="w-3 h-3" />
                </button>
            </div>

            {/* Job ID */}
            <div className="px-3 pb-2">
                <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/60">
                    <Hash className="w-3 h-3 text-purple-400/60 shrink-0" />
                    <span className="font-mono text-[9px] text-white/50 truncate" title={n.jobId}>
                        {shortJobId}
                    </span>
                </div>
            </div>

            {/* Footer: timer */}
            <div className="flex items-center justify-end px-3 py-1.5 border-t border-white/[0.06] bg-white/[0.02]">
                <span className="text-[9px] font-mono text-muted-foreground/40 tabular-nums">
                    {secondsLeft}s
                </span>
            </div>

            {/* Progress bar */}
            <div className="h-[2px] bg-white/[0.04]">
                <div
                    className="h-full bg-gradient-to-r from-blue-500/60 to-purple-500/60 transition-[width] duration-100 ease-linear"
                    style={{ width: `${progress}%` }}
                />
            </div>
        </div>
    );
}

/* ─── Container that manages multiple notifications ─── */
export default function JoinNotificationContainer({
    enabled,
    duration = 5,
}: {
    enabled: boolean;
    duration?: number;
}) {
    const [notifications, setNotifications] = useState<JoinNotification[]>([]);
    const idRef = useRef(0);

    const addNotification = useCallback((data: JoinNotificationData) => {
        const id = ++idRef.current;
        setNotifications(prev => [...prev.slice(-4), { ...data, id, createdAt: Date.now() }]); // Max 5 stacked
    }, []);

    const dismissNotification = useCallback((id: number) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    // Register global trigger
    useEffect(() => {
        (window as any).__showJoinNotification = (data: JoinNotificationData) => {
            if (enabled) addNotification(data);
        };
        return () => { delete (window as any).__showJoinNotification; };
    }, [enabled, addNotification]);

    if (!enabled || notifications.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2 pointer-events-auto">
            {notifications.map(n => (
                <NotificationCard
                    key={n.id}
                    notification={n}
                    duration={duration}
                    onDismiss={dismissNotification}
                />
            ))}
        </div>
    );
}
