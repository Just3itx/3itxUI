"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { KeyRound, RefreshCw, Loader2, CheckCircle2, XCircle, Clock, Download, Fingerprint, Copy, Eye, EyeOff } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import * as fsBridge from "@/lib/fs-bridge";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface AccountInfo {
    hasAccount: boolean;
    expiry: string;
    version: string;
    binExists: boolean;
    accountKey: string;
    error: string;
}

/* ─── Odometer Digit ─── */
function OdometerDigit({ value }: { value: string }) {
    const prevRef = useRef(value);
    const prev = prevRef.current;
    const changed = prev !== value;
    useEffect(() => { prevRef.current = value; }, [value]);

    return (
        <span className="inline-block overflow-hidden relative" style={{ width: 16, height: 28 }}>
            {changed && (
                <span key={`o-${value}`} className="absolute inset-0 flex items-center justify-center odo-out">{prev}</span>
            )}
            <span key={`i-${value}`} className={cn("absolute inset-0 flex items-center justify-center", changed && "odo-in")}>{value}</span>
        </span>
    );
}

function OdometerNum({ value }: { value: string }) {
    return (
        <span className="inline-flex items-center justify-center" style={{ fontVariantNumeric: "tabular-nums" }}>
            {value.split("").map((ch, i) => <OdometerDigit key={i} value={ch} />)}
        </span>
    );
}

/* ─── Countdown ─── */
function useCountdown(unixStr: string | undefined) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
    if (!unixStr) return null;
    const target = parseInt(unixStr) * 1000;
    const diff = target - now;
    if (diff <= 0) return { expired: true, d: "00", h: "00", m: "00", s: "00", pct: 0, days: 0 };
    const t = Math.floor(diff / 1000);
    const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return { expired: false, d: String(d).padStart(2, "0"), h: String(h).padStart(2, "0"), m: String(m).padStart(2, "0"), s: String(s).padStart(2, "0"), pct: Math.min(100, (d / 30) * 100), days: d };
}

export default function SynAccountPanel() {
    const [info, setInfo] = useState<AccountInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [licenseKey, setLicenseKey] = useState("");
    const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [showDownloadPopup, setShowDownloadPopup] = useState(false);
    const [weaoVersion, setWeaoVersion] = useState<string | null>(null);
    const [keyRevealed, setKeyRevealed] = useState(false);
    const [keyCopied, setKeyCopied] = useState(false);
    const cd = useCountdown(info?.hasAccount ? info.expiry : undefined);

    useEffect(() => { fetch("/api/weao").then(r => r.json()).then(d => { if (d?.version) setWeaoVersion(d.version); }).catch(() => {}); }, []);
    const refresh = useCallback(async () => {
        setLoading(true); setMessage(null);
        try { setInfo(await fsBridge.getAccountInfo()); } catch { setInfo(null); } finally { setLoading(false); }
    }, []);
    useEffect(() => { refresh(); }, [refresh]);

    const handleRedeem = async () => {
        if (!licenseKey.trim()) return; setActionLoading("redeem"); setMessage(null);
        try { const r = await fsBridge.redeemKey(licenseKey.trim()); if (r?.code === 0) { setMessage({ text: "Key redeemed!", type: "success" }); setLicenseKey(""); refresh(); } else setMessage({ text: r?.error || "Failed", type: "error" }); } catch { setMessage({ text: "Failed to redeem", type: "error" }); } finally { setActionLoading(null); }
    };
    const handleResetHwid = async () => {
        setActionLoading("hwid"); setMessage(null);
        try { const r = await fsBridge.resetHwid(); if (r?.code === 0) setMessage({ text: "HWID reset!", type: "success" }); else setMessage({ text: r?.error || "Failed", type: "error" }); } catch { setMessage({ text: "Failed", type: "error" }); } finally { setActionLoading(null); }
    };
    const handleCreate = async () => {
        if (!licenseKey.trim()) return; setActionLoading("create"); setMessage(null);
        try { const r = await fsBridge.createAccount(licenseKey.trim()); if (r?.ok) { setMessage({ text: "Account created!", type: "success" }); setLicenseKey(""); refresh(); } else setMessage({ text: r?.error || "Failed", type: "error" }); } catch { setMessage({ text: "Failed", type: "error" }); } finally { setActionLoading(null); }
    };
    const handleDownload = () => { setShowDownloadPopup(true); fsBridge.openUrl("https://z.synapse.do/"); };

    const units = cd ? [
        { l: "DAYS", v: cd.d }, { l: "HRS", v: cd.h }, { l: "MIN", v: cd.m }, { l: "SEC", v: cd.s }
    ] : [];

    return (
        <div className="flex-1 flex flex-col overflow-hidden animate-panel-in">
            {/* Header bar */}
            <div className="flex items-center h-[36px] px-3 border-b border-white/[0.06] shrink-0">
                <KeyRound className="w-3.5 h-3.5 text-muted-foreground mr-2" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Synapse Z</span>
                <div className="flex-1" />
                <button onClick={refresh} disabled={loading} className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.06] transition-colors">
                    <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
                </button>
            </div>

            <ScrollArea className="flex-1 min-h-0">
                <div className="p-3 space-y-2">
                    {/* Toast */}
                    {message && (
                        <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] animate-fade-slide-up", message.type === "success" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400")}>
                            {message.type === "success" ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <XCircle className="w-3 h-3 shrink-0" />}
                            {message.text}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 text-muted-foreground/40 animate-spin" /></div>
                    ) : (
                        <>
                            {/* ── Status bar ── */}
                            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] animate-fade-slide-up">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[12px] font-semibold text-foreground">
                                            {info?.hasAccount ? "Synapse Z" : "No Account"}
                                        </span>
                                        {info?.hasAccount && (
                                            <span className="text-[8px] px-1.5 py-[1px] rounded-full bg-white/[0.06] text-muted-foreground/60 font-semibold border border-white/[0.08] tracking-wider uppercase">Active</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-muted-foreground/40">
                                        <span>v{weaoVersion || info?.version || "?"}</span>
                                        <span className="text-white/[0.06]">·</span>
                                        <div className={cn("w-1.5 h-1.5 rounded-full", info?.binExists ? "bg-emerald-400" : "bg-amber-400")} />
                                        <span className={info?.binExists ? "text-emerald-400/60" : "text-amber-400/60"}>
                                            {info?.binExists ? "Installed" : "Not Found"}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* ── Account Key ── */}
                            {info?.hasAccount && info.accountKey && (
                                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 animate-fade-slide-up" style={{ animationDelay: "15ms" }}>
                                    <span className="text-[8px] text-muted-foreground/35 uppercase tracking-[0.12em] font-semibold block mb-1.5">Account Key</span>
                                    <div className="flex items-center gap-1.5">
                                        <div className="flex-1 relative overflow-hidden">
                                            <div className={cn(
                                                "h-[28px] px-2.5 flex items-center rounded-md bg-white/[0.03] border border-white/[0.06] font-mono text-[10px] text-muted-foreground/60 select-all transition-all",
                                                !keyRevealed && "blur-[5px] select-none"
                                            )}>
                                                {info.accountKey}
                                            </div>
                                            {!keyRevealed && (
                                                <button
                                                    onClick={() => setKeyRevealed(true)}
                                                    className="absolute inset-0 flex items-center justify-center gap-1.5 bg-white/[0.01] hover:bg-white/[0.03] transition-colors rounded-md cursor-pointer"
                                                >
                                                    <Eye className="w-3 h-3 text-muted-foreground/50" />
                                                    <span className="text-[10px] font-medium text-muted-foreground/50">Reveal</span>
                                                </button>
                                            )}
                                        </div>
                                        {keyRevealed && (
                                            <button
                                                onClick={() => setKeyRevealed(false)}
                                                className="h-[28px] w-[28px] flex items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.03] text-muted-foreground/40 hover:bg-white/[0.06] hover:text-foreground/60 transition-all shrink-0"
                                                title="Hide key"
                                            >
                                                <EyeOff className="w-3 h-3" />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(info.accountKey);
                                                setKeyCopied(true);
                                                setTimeout(() => setKeyCopied(false), 1500);
                                            }}
                                            className={cn(
                                                "h-[28px] px-2.5 flex items-center gap-1 rounded-md border border-white/[0.06] text-[9px] font-medium transition-all shrink-0",
                                                keyCopied
                                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                                    : "bg-white/[0.03] text-muted-foreground/40 hover:bg-white/[0.06] hover:text-foreground/60"
                                            )}
                                        >
                                            {keyCopied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                            {keyCopied ? "Copied" : "Copy"}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* ── Countdown ── */}
                            {info?.hasAccount && cd && (
                                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-3 animate-fade-slide-up" style={{ animationDelay: "30ms" }}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            <Clock className={cn("w-3 h-3", cd.expired ? "text-red-400/60" : "text-muted-foreground/30")} />
                                            <span className="text-[8px] text-muted-foreground/35 uppercase tracking-[0.12em] font-semibold">
                                                {cd.expired ? "Expired" : "Time Remaining"}
                                            </span>
                                        </div>
                                        {info.expiry && (
                                            <span className="text-[8px] text-muted-foreground/25">
                                                {cd.expired ? "Expired" : "Exp."} {new Date(parseInt(info.expiry) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                            </span>
                                        )}
                                    </div>

                                    {/* Tiles */}
                                    <div className="flex gap-2">
                                        {units.map((u, i) => (
                                            <div key={u.l} className="flex-1 flex flex-col items-center gap-1">
                                                <div className={cn(
                                                    "w-full flex items-center justify-center rounded-lg border font-mono font-bold text-[20px] leading-none",
                                                    cd.expired
                                                        ? "bg-red-500/[0.04] border-red-500/10 text-red-400/80"
                                                        : "bg-white/[0.03] border-white/[0.06] text-foreground"
                                                )} style={{ height: 48 }}>
                                                    <OdometerNum value={u.v} />
                                                </div>
                                                <span className="text-[7px] text-muted-foreground/25 font-medium tracking-[0.15em]">{u.l}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Progress */}
                                    <div className="space-y-1">
                                        <div className="h-[3px] rounded-full bg-white/[0.04] overflow-hidden">
                                            <div
                                                className={cn("h-full rounded-full transition-all duration-1000", cd.expired ? "bg-red-500/40" : "bg-white/20")}
                                                style={{ width: `${cd.pct}%` }}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between text-[8px] text-muted-foreground/25">
                                            <span>{cd.expired ? "Subscription expired" : `${cd.days} days remaining`}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ── Key Input + Actions ── */}
                            <div className="flex gap-2 animate-fade-slide-up" style={{ animationDelay: "60ms" }}>
                                {/* Key input */}
                                <div className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                                    <span className="text-[8px] text-muted-foreground/35 uppercase tracking-[0.12em] font-semibold block mb-1.5">
                                        {info?.hasAccount ? "Redeem Key" : "License Key"}
                                    </span>
                                    <div className="flex gap-1.5">
                                        <input
                                            type="text"
                                            value={licenseKey}
                                            onChange={e => setLicenseKey(e.target.value)}
                                            placeholder="Enter license key..."
                                            className="flex-1 h-[28px] px-2.5 text-[10px] bg-white/[0.03] border border-white/[0.06] rounded-md text-foreground placeholder:text-muted-foreground/20 outline-none focus:border-white/[0.15] transition-colors font-mono"
                                        />
                                        <button
                                            onClick={info?.hasAccount ? handleRedeem : handleCreate}
                                            disabled={!licenseKey.trim() || !!actionLoading}
                                            className={cn(
                                                "h-[28px] px-3 flex items-center gap-1.5 rounded-md text-[10px] font-medium transition-all shrink-0 bg-white/[0.06] border border-white/[0.08] text-foreground/80 hover:bg-white/[0.1]",
                                                (!licenseKey.trim() || actionLoading) && "opacity-30 cursor-not-allowed"
                                            )}
                                        >
                                            {(actionLoading === "redeem" || actionLoading === "create") ? <Loader2 className="w-3 h-3 animate-spin" /> : info?.hasAccount ? <KeyRound className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                                            {info?.hasAccount ? "Redeem" : "Create"}
                                        </button>
                                    </div>
                                    {!info?.hasAccount && <p className="text-[8px] text-muted-foreground/20 mt-1.5">No account found. Enter a license key to create one.</p>}
                                </div>

                                {/* Action buttons */}
                                <div className="flex flex-col gap-1.5 shrink-0" style={{ width: 110 }}>
                                    {info?.hasAccount && (
                                        <button
                                            onClick={handleResetHwid}
                                            disabled={!!actionLoading}
                                            className={cn(
                                                "flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-[10px] font-medium text-muted-foreground/50 hover:bg-white/[0.05] hover:text-foreground/80 transition-all",
                                                actionLoading && "opacity-40 cursor-not-allowed"
                                            )}
                                        >
                                            {actionLoading === "hwid" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Fingerprint className="w-3 h-3" />}
                                            Reset HWID
                                        </button>
                                    )}
                                    <button
                                        onClick={handleDownload}
                                        className={cn(
                                            "flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] text-[10px] font-medium text-muted-foreground/50 hover:bg-white/[0.05] hover:text-foreground/80 transition-all",
                                            !info?.hasAccount && "h-full"
                                        )}
                                    >
                                        <Download className="w-3 h-3" />
                                        Install
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </ScrollArea>

            {/* Download popup */}
            {showDownloadPopup && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-[#141416] border border-white/[0.1] rounded-xl p-5 max-w-[300px] w-full shadow-xl animate-fade-slide-up">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                                <Download className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                            <span className="text-[12px] font-semibold text-foreground">Install Synapse Z</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed mb-3">Install it yourself {">"} :(</p>
                        <button onClick={() => setShowDownloadPopup(false)} className="w-full h-[28px] rounded-lg bg-white/[0.06] border border-white/[0.08] text-[10px] font-medium text-foreground hover:bg-white/[0.1] transition-all">Got it</button>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes odo-i { from { transform: translateY(100%); } to { transform: translateY(0); } }
                @keyframes odo-o { from { transform: translateY(0); } to { transform: translateY(-100%); } }
                .odo-in { animation: odo-i 0.3s ease-out forwards; }
                .odo-out { animation: odo-o 0.3s ease-out forwards; }
            `}</style>
        </div>
    );
}
