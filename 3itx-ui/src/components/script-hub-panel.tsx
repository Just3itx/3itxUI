"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
    Loader2, Search, ChevronLeft, ChevronRight,
    Key, ShieldCheck, ShieldAlert, ChevronDown, Eye,
    TrendingUp, Clock, Flame,
} from "lucide-react";

/* ─── Types ─── */
interface NormalizedScript {
    id: string;
    title: string;
    description: string;
    image: string;
    script: string;
    verified: boolean;
    hasKey: boolean;
    views: number;
    gameName: string;
    isPatched?: boolean;
    isUniversal?: boolean;
    createdAt?: string;
}

type Provider = "scriptblox" | "rscripts";
type SortMode = "trending" | "newest" | "popular";

interface ScriptHubPanelProps {
    onLoad: (title: string, content: string) => void;
}

/* ─── ScriptBlox JSON config (your GitHub hub) ─── */
const GITHUB_HUB_URL =
    "https://raw.githubusercontent.com/Just3itx/3itxUI/refs/heads/main/ScriptHub.json";

/* ─── Helpers ─── */

const SCRIPTBLOX_IMG = "https://scriptblox.com";

function normalizeScriptBlox(raw: any): NormalizedScript {
    const img = raw.image?.startsWith("http")
        ? raw.image
        : raw.image
            ? `${SCRIPTBLOX_IMG}${raw.image}`
            : raw.game?.imageUrl
                ? `${SCRIPTBLOX_IMG}${raw.game.imageUrl}`
                : "";
    return {
        id: raw._id || raw.slug || raw.title,
        title: raw.title || "Untitled",
        description: raw.game?.name || "",
        image: img,
        script: raw.script || "",
        verified: raw.verified ?? false,
        hasKey: raw.key ?? false,
        views: raw.views ?? 0,
        gameName: raw.game?.name || "Unknown",
        isPatched: raw.isPatched,
        isUniversal: raw.isUniversal,
        createdAt: raw.createdAt,
    };
}

function normalizeRScripts(raw: any): NormalizedScript {
    return {
        id: raw._id || raw.title,
        title: raw.title || "Untitled",
        description: raw.description || raw.game?.title || "",
        image: raw.image || raw.game?.imgurl || "",
        script: raw.rawScript
            ? `loadstring(game:HttpGet("${raw.rawScript}"))()`
            : "",
        verified: raw.user?.verified ?? false,
        hasKey: raw.keySystem ?? false,
        views: raw.views ?? 0,
        gameName: raw.game?.title || "Unknown",
        isPatched: false,
        isUniversal: false,
        createdAt: raw.createdAt,
    };
}

/* ─── Component ─── */
export default function ScriptHubPanel({ onLoad }: ScriptHubPanelProps) {
    const [provider, setProvider] = useState<Provider>("scriptblox");
    const [showDropdown, setShowDropdown] = useState(false);
    const [scripts, setScripts] = useState<NormalizedScript[]>([]);
    const [hubScripts, setHubScripts] = useState<NormalizedScript[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [maxPages, setMaxPages] = useState(1);
    const [query, setQuery] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [sortMode, setSortMode] = useState<SortMode>("trending");
    const [confirmScript, setConfirmScript] = useState<NormalizedScript | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // Fetch GitHub hub scripts on mount
    useEffect(() => {
        fetch(GITHUB_HUB_URL, { cache: "no-store" })
            .then(r => r.json())
            .then((data: Record<string, { Script: string; Image: string; Description: string }>) => {
                setHubScripts(
                    Object.entries(data).map(([name, entry]) => ({
                        id: name,
                        title: name,
                        description: entry.Description,
                        image: entry.Image,
                        script: entry.Script,
                        verified: true,
                        hasKey: false,
                        views: 0,
                        gameName: "Featured",
                    }))
                );
            })
            .catch(() => { });
    }, []);

    // Fetch scripts from provider API
    const fetchScripts = useCallback(async (p: number, q: string, sort: SortMode) => {
        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams({
                provider,
                page: String(p),
            });
            if (q) params.set("q", q);

            if (provider === "rscripts") {
                if (sort === "trending" || sort === "popular") {
                    params.set("orderBy", "totalViews");
                    params.set("sort", "desc");
                } else {
                    params.set("orderBy", "date");
                    params.set("sort", "desc");
                }
            }

            const res = await fetch(`/api/scripts?${params.toString()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            if (provider === "scriptblox") {
                const result = data.result || data;
                const list = result.scripts || [];
                setScripts(list.map(normalizeScriptBlox));
                setMaxPages(result.totalPages || 1);
            } else {
                const list = data.scripts || [];
                setScripts(list.map(normalizeRScripts));
                setMaxPages(data.info?.maxPages || 1);
            }
        } catch (err: any) {
            setError(err.message || "Failed to fetch");
            setScripts([]);
        } finally {
            setLoading(false);
        }
    }, [provider]);

    // Fetch on mount and when filters change
    useEffect(() => {
        fetchScripts(page, query, sortMode);
    }, [page, query, sortMode, provider, fetchScripts]);

    const doSearch = () => {
        setPage(1);
        setQuery(searchInput);
    };

    const handleClick = (script: NormalizedScript) => {
        if (!script.verified) {
            setConfirmScript(script);
        } else {
            onLoad(script.title, script.script);
        }
    };

    const confirmExecute = () => {
        if (confirmScript) {
            onLoad(confirmScript.title, confirmScript.script);
            setConfirmScript(null);
        }
    };

    return (
        <div className="h-full overflow-auto">
            <div className="p-5">
                {/* ─── Header Row ─── */}
                <div className="flex items-center gap-3 mb-5">
                    <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[1.5px]">
                        Script Hub
                    </h3>
                    <div className="flex-1" />

                    {/* Provider dropdown */}
                    <div className="relative" ref={dropdownRef}>
                        <button
                            onClick={() => setShowDropdown(!showDropdown)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-white/[0.04] border border-white/[0.08] rounded-lg text-muted-foreground hover:bg-white/[0.08] hover:text-foreground transition-colors"
                        >
                            {provider === "scriptblox" ? "ScriptBlox" : "RScripts"}
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        {showDropdown && (
                            <div className="absolute right-0 top-full mt-1 z-50 bg-[#141418] border border-white/[0.1] rounded-lg shadow-2xl overflow-hidden min-w-[140px]">
                                {(["scriptblox", "rscripts"] as Provider[]).map(p => (
                                    <button
                                        key={p}
                                        onClick={() => {
                                            setProvider(p);
                                            setPage(1);
                                            setShowDropdown(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-[11px] transition-colors ${provider === p
                                            ? "bg-purple-500/20 text-purple-300"
                                            : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                                            }`}
                                    >
                                        {p === "scriptblox" ? "ScriptBlox" : "RScripts"}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ─── Featured (GitHub Hub) ─── */}
                {hubScripts.length > 0 && !query && (
                    <div className="mb-6">
                        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                            <Flame className="w-3 h-3 text-orange-400" />
                            Featured
                        </h4>
                        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                            {hubScripts.map((s, i) => (
                                <button
                                    key={s.id}
                                    onClick={() => handleClick(s)}
                                    className="group relative flex-shrink-0 w-[200px] text-left rounded-xl overflow-hidden border border-white/[0.06] bg-white/[0.02] transition-all duration-300 hover:border-purple-500/30 hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(139,92,246,0.15)]"
                                    style={{ animation: `fadeSlideUp 0.4s ease-out ${i * 60}ms backwards` }}
                                >
                                    <div className="relative h-[100px] overflow-hidden bg-black/40">
                                        <img src={s.image} alt={s.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c0e] via-transparent to-transparent opacity-80" />
                                    </div>
                                    <div className="p-3 pt-2">
                                        <h5 className="text-[12px] font-semibold text-foreground truncate">{s.title}</h5>
                                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{s.description}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ─── Search + Sort ─── */}
                <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 flex items-center gap-0 bg-white/[0.04] border border-white/[0.08] rounded-lg overflow-hidden focus-within:border-purple-500/40 transition-colors">
                        <Search className="w-3.5 h-3.5 ml-3 text-muted-foreground shrink-0" />
                        <input
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && doSearch()}
                            placeholder="Search scripts..."
                            className="flex-1 bg-transparent border-none outline-none text-[12px] text-foreground px-2.5 py-2 placeholder:text-muted-foreground/50"
                        />
                        <button
                            onClick={doSearch}
                            className="px-3 py-2 text-[10px] font-medium text-purple-300 hover:bg-purple-500/10 transition-colors"
                        >
                            Search
                        </button>
                    </div>

                    {/* Sort buttons */}
                    <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-lg overflow-hidden">
                        {([
                            { mode: "trending" as SortMode, icon: TrendingUp, label: "Hot" },
                            { mode: "newest" as SortMode, icon: Clock, label: "New" },
                            { mode: "popular" as SortMode, icon: Eye, label: "Views" },
                        ]).map(({ mode, icon: Icon, label }) => (
                            <button
                                key={mode}
                                onClick={() => { setSortMode(mode); setPage(1); }}
                                className={`flex items-center gap-1 px-2.5 py-2 text-[10px] font-medium transition-colors ${sortMode === mode
                                    ? "bg-purple-500/20 text-purple-300"
                                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                                    }`}
                            >
                                <Icon className="w-3 h-3" />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* ─── Loading ─── */}
                {loading && (
                    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 text-xs">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading scripts...
                    </div>
                )}

                {/* ─── Error ─── */}
                {error && !loading && (
                    <div className="text-center py-16 text-red-400 text-xs">
                        Failed to load: {error}
                    </div>
                )}

                {/* ─── Script Grid ─── */}
                {!loading && !error && (
                    <>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                            {scripts.map((s, i) => (
                                <button
                                    key={s.id}
                                    onClick={() => handleClick(s)}
                                    className="group relative text-left rounded-xl overflow-hidden border border-white/[0.06] bg-white/[0.02] transition-all duration-300 ease-out hover:border-white/[0.12] hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)] focus:outline-none"
                                    style={{ animation: `fadeSlideUp 0.35s ease-out ${i * 40}ms backwards` }}
                                >
                                    {/* Image */}
                                    <div className="relative h-[110px] overflow-hidden bg-black/30">
                                        <img
                                            src={s.image}
                                            alt={s.title}
                                            className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
                                            loading="lazy"
                                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c0e] via-[#0c0c0e]/30 to-transparent" />

                                        {/* Key icon */}
                                        {s.hasKey && (
                                            <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/20 border border-yellow-500/30 rounded-md backdrop-blur-sm">
                                                <Key className="w-3 h-3 text-yellow-400" />
                                                <span className="text-[9px] font-semibold text-yellow-300">KEY</span>
                                            </div>
                                        )}

                                        {/* Verified badge */}
                                        {s.verified && (
                                            <div className="absolute top-2 left-2">
                                                <ShieldCheck className="w-4 h-4 text-green-400 drop-shadow-lg" />
                                            </div>
                                        )}

                                        {/* Patched badge */}
                                        {s.isPatched && (
                                            <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-red-500/20 border border-red-500/30 rounded-md backdrop-blur-sm">
                                                <span className="text-[9px] font-semibold text-red-300">PATCHED</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="p-3 pt-2.5">
                                        <h4 className="text-[12px] font-semibold text-foreground mb-0.5 truncate group-hover:text-white transition-colors">
                                            {s.title}
                                        </h4>
                                        <p className="text-[10px] text-muted-foreground line-clamp-1 mb-1.5">
                                            {s.gameName}
                                        </p>
                                        <div className="flex items-center gap-2 text-[9px] text-muted-foreground/60">
                                            <span className="flex items-center gap-0.5">
                                                <Eye className="w-3 h-3" />
                                                {s.views.toLocaleString()}
                                            </span>
                                            {s.isUniversal && (
                                                <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded text-[8px] font-medium">
                                                    Universal
                                                </span>
                                            )}
                                            {!s.verified && (
                                                <ShieldAlert className="w-3 h-3 text-yellow-500/60 ml-auto" />
                                            )}
                                        </div>
                                    </div>

                                    {/* Bottom glow on hover */}
                                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-purple-500/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                                </button>
                            ))}
                        </div>

                        {/* Pagination */}
                        {maxPages > 1 && (
                            <div className="flex items-center justify-center gap-3 mt-6 mb-2">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] bg-white/[0.04] border border-white/[0.08] rounded-lg text-muted-foreground hover:bg-white/[0.08] hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                >
                                    <ChevronLeft className="w-3 h-3" />
                                    Prev
                                </button>
                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                    {page} / {maxPages.toLocaleString()}
                                </span>
                                <button
                                    onClick={() => setPage(p => Math.min(maxPages, p + 1))}
                                    disabled={page >= maxPages}
                                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] bg-white/[0.04] border border-white/[0.08] rounded-lg text-muted-foreground hover:bg-white/[0.08] hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                >
                                    Next
                                    <ChevronRight className="w-3 h-3" />
                                </button>
                            </div>
                        )}

                        {/* RScripts attribution */}
                        {provider === "rscripts" && (
                            <p className="text-center text-[9px] text-muted-foreground/40 mt-4">
                                Powered by Rscripts.net
                            </p>
                        )}
                    </>
                )}
            </div>

            {/* ─── Unverified Confirmation Modal ─── */}
            {confirmScript && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div
                        className="bg-[#141418] border border-white/[0.1] rounded-2xl p-6 max-w-[380px] w-full mx-4 shadow-2xl"
                        style={{ animation: "fadeSlideUp 0.25s ease-out" }}
                    >
                        <div className="flex items-center gap-2 mb-3">
                            <ShieldAlert className="w-5 h-5 text-yellow-400" />
                            <h3 className="text-[14px] font-semibold text-foreground">
                                Unverified Script
                            </h3>
                        </div>
                        <p className="text-[12px] text-muted-foreground leading-relaxed mb-1">
                            <span className="font-medium text-foreground">{confirmScript.title}</span> is not verified.
                        </p>
                        <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-5">
                            Unverified scripts may contain malicious code. Execute at your own risk.
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setConfirmScript(null)}
                                className="flex-1 px-4 py-2 text-[12px] font-medium bg-white/[0.06] border border-white/[0.1] rounded-lg text-muted-foreground hover:bg-white/[0.1] hover:text-foreground transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmExecute}
                                className="flex-1 px-4 py-2 text-[12px] font-medium bg-yellow-500/20 border border-yellow-500/30 rounded-lg text-yellow-300 hover:bg-yellow-500/30 transition-colors"
                            >
                                Execute Anyway
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Keyframes */}
            <style>{`
                @keyframes fadeSlideUp {
                    from { opacity: 0; transform: translateY(16px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
