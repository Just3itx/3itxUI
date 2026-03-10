"use client";

import { useState, useEffect } from "react";

interface LoadingScreenProps {
    onComplete: () => void;
}

const STEPS = [
    "Initializing runtime...",
    "Loading execution engine...",
    "Preparing script environment...",
    "Connecting to Roblox...",
    "Loading modules...",
    "Finalizing...",
    "Ready.",
];

export default function LoadingScreen({ onComplete }: LoadingScreenProps) {
    const [step, setStep] = useState(0);
    const [fading, setFading] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => {
            setStep((prev) => {
                const next = prev + 1;
                if (next >= STEPS.length) {
                    clearInterval(timer);
                    setTimeout(() => {
                        setFading(true);
                        setTimeout(onComplete, 600);
                    }, 400);
                }
                return Math.min(next, STEPS.length - 1);
            });
        }, 380);
        return () => clearInterval(timer);
    }, [onComplete]);

    const progress = ((step + 1) / STEPS.length) * 100;

    return (
        <div
            className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0a0a0c] transition-all duration-600 ${fading ? "opacity-0 pointer-events-none" : "opacity-100"
                }`}
        >
            {/* Spinning rings */}
            <div className="relative w-16 h-16 mb-8">
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white/60 animate-spin-slow" />
                <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-white/30 animate-spin-reverse" />
                <div className="absolute inset-4 rounded-full border border-transparent border-t-white/15 animate-spin-slow [animation-duration:2.4s]" />
            </div>

            {/* Title */}
            <h1 className="text-lg font-bold tracking-[4px] uppercase mb-2 text-foreground">
                3itx UI
            </h1>
            <p className="text-[10px] text-muted-foreground tracking-widest mb-7">
                Loading...
            </p>

            {/* Progress bar */}
            <div className="w-[220px] h-[2px] bg-white/5 rounded-full overflow-hidden mb-3">
                <div
                    className="h-full bg-white/60 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                />
            </div>

            {/* Status */}
            <p className="text-[10px] text-muted-foreground tracking-wide">
                {STEPS[step]}
            </p>
        </div>
    );
}
