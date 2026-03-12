"use client";

import { useState, useCallback } from "react";
import { CheckCircle, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Toast {
    id: number;
    message: string;
    type: "success" | "error" | "info";
}

let nextId = 0;

export function useToast() {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const show = useCallback((message: string, type: Toast["type"] = "info") => {
        const id = nextId++;
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 3200);
    }, []);

    return { toasts, show };
}

const icons: Record<string, React.ElementType> = {
    success: CheckCircle,
    error: XCircle,
    info: Info,
};

const colors: Record<string, string> = {
    success: "text-emerald-400",
    error: "text-red-400",
    info: "text-blue-400",
};

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
    return (
        <div className="fixed bottom-10 right-4 z-[8000] flex flex-col-reverse gap-2">
            {toasts.map((t) => {
                const Icon = icons[t.type];
                return (
                    <div
                        key={t.id}
                        className="flex items-center gap-2.5 py-2.5 px-4 glass rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)] text-xs text-foreground max-w-[340px] animate-toast-in"
                    >
                        <Icon className={cn("w-3.5 h-3.5 shrink-0", colors[t.type])} />
                        <span>{t.message}</span>
                    </div>
                );
            })}
        </div>
    );
}
