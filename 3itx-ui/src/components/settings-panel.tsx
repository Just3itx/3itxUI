"use client";

import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback, useRef } from "react";
import { queueCommand } from "@/lib/fs-bridge";

export interface ExecutorSettings {
    topMost: boolean;
    autoExec: boolean;
    lspConnect: boolean;
    unlockFPS: boolean;
    debugMode: boolean;
    redirectConsole: boolean;
    wordWrap: boolean;
    lineNumbers: boolean;
    bracketPairColorization: boolean;
    autoSuggestions: boolean;
    joinNotifications: boolean;
    joinNotificationDuration: number;
    opacity: number;
    editorFont: number;
    theme: string;
    executionMethod: "piper" | "scheduler";
}

interface SynapseSettings {
    internal_ui_key: string;
    disable_purchases: boolean;
    beta_app_execution: boolean;
    internal_ui_dex_display_hidden: boolean;
    internal_ui_dex_display_notscriptable: boolean;
    enable_setfflag: boolean;
    enable_raknet: boolean;
    enable_replicatesignal: boolean;
    enable_cfiresignal: boolean;
    internal_ui_scaling: number;
    internal_ui_highlighting_fuzz_score: number;
}

const DEFAULT_SYNAPSE: SynapseSettings = {
    internal_ui_key: "Right Ctrl",
    disable_purchases: true,
    beta_app_execution: false,
    internal_ui_dex_display_hidden: true,
    internal_ui_dex_display_notscriptable: true,
    enable_setfflag: true,
    enable_raknet: true,
    enable_replicatesignal: true,
    enable_cfiresignal: true,
    internal_ui_scaling: 1.0,
    internal_ui_highlighting_fuzz_score: 20.0,
};

interface SettingsPanelProps {
    settings: ExecutorSettings;
    onChange: (settings: ExecutorSettings) => void;
}

/* ─── Theme definitions ─── */
const THEMES = [
    { id: "default", label: "Default", dots: ["#a855f7", "#3b82f6"] },
    { id: "synapse", label: "Synapse X", dots: ["#9ca3af", "#6b7280"] },
    { id: "midnight", label: "Midnight", dots: ["#6366f1", "#06b6d4"] },
    { id: "emerald", label: "Emerald", dots: ["#10b981", "#10b981"] },
    { id: "rose", label: "Rose", dots: ["#f43f5e", "#f43f5e"] },
    { id: "amber", label: "Amber", dots: ["#f59e0b", "#f59e0b"] },
    { id: "ocean", label: "Ocean", dots: ["#3b82f6", "#3b82f6"] },
    { id: "minimal", label: "Minimal", dots: ["#9ca3af", "#d1d5db"] },
];

/* ─── Supported Synapse Z keybinds ─── */
const SUPPORTED_KEYS = [
    "Delete", "Left Ctrl", "Right Ctrl", "Left Shift", "Right Shift",
    "Left Alt", "Right Alt", "Insert", "Home",
    "F1", "F2", "F3", "F4", "F5", "F6",
    "F7", "F8", "F9", "F10", "F11", "F12",
];

export default function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
    const update = (partial: Partial<ExecutorSettings>) =>
        onChange({ ...settings, ...partial });

    /* ─── Synapse Z settings state ─── */
    const [synSettings, setSynSettings] = useState<SynapseSettings>(DEFAULT_SYNAPSE);
    const [synLoaded, setSynLoaded] = useState(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Load on mount
    useEffect(() => {
        fetch("/api/synapse-settings")
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data && !data.error) {
                    setSynSettings((prev) => ({ ...prev, ...data }));
                }
                setSynLoaded(true);
            })
            .catch(() => setSynLoaded(true));
    }, []);

    // Save helper with debounce
    const saveSynapse = useCallback((newSettings: SynapseSettings, skipReload = false) => {
        setSynSettings(newSettings);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            fetch("/api/synapse-settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newSettings),
            })
                .then(() => { if (!skipReload) queueCommand("reload_settings"); })
                .catch(() => { /* silent */ });
        }, 300);
    }, []);

    const SLIDER_KEYS = new Set(["internal_ui_scaling", "internal_ui_highlighting_fuzz_score"]);

    const updateSyn = useCallback(
        (partial: Partial<SynapseSettings>) => {
            const isSliderOnly = Object.keys(partial).every(k => SLIDER_KEYS.has(k));
            saveSynapse({ ...synSettings, ...partial }, isSliderOnly);
        },
        [synSettings, saveSynapse]
    );

    return (
        <div className="flex-1 overflow-y-auto animate-panel-in">
            <div className="p-4 space-y-4">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">Settings</span>
                    </div>
                </div>

                {/* Interface Settings label */}
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-[1.5px] border-b border-white/[0.06] pb-2">
                    Interface Settings
                </div>

                {/* Theme Section */}
                <section className="space-y-3 animate-fade-slide-up" style={{ animationDelay: "0ms" }}>
                    <div>
                        <span className="text-[13px] font-semibold text-foreground">Theme</span>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Color scheme for the editor and interface</p>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                        {THEMES.map((t) => {
                            const active = settings.theme === t.id;
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => update({ theme: t.id })}
                                    className={cn(
                                        "relative flex flex-col items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-all duration-150 border",
                                        active
                                            ? "bg-white/[0.08] border-white/[0.15]"
                                            : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1]"
                                    )}
                                >
                                    {active && (
                                        <Check className="absolute top-1.5 right-1.5 w-3 h-3 text-muted-foreground" />
                                    )}
                                    <div className="flex gap-1.5">
                                        {t.dots.map((color, i) => (
                                            <div
                                                key={i}
                                                className="w-2.5 h-2.5 rounded-full"
                                                style={{ backgroundColor: color }}
                                            />
                                        ))}
                                    </div>
                                    <span className="text-[10px] font-medium text-foreground">{t.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </section>

                {/* Editor Font Size */}
                <section className="space-y-2 animate-fade-slide-up" style={{ animationDelay: "40ms" }}>
                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-[13px] font-semibold text-foreground">Editor Font Size</span>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{settings.editorFont}px</p>
                        </div>
                        <Slider
                            className="w-[140px]"
                            min={10}
                            max={22}
                            step={1}
                            value={settings.editorFont}
                            onValueChange={(v) => update({ editorFont: typeof v === 'number' ? v : v[0] })}
                        />
                    </div>
                </section>

                {/* Editor Features */}
                <section className="space-y-1 animate-fade-slide-up" style={{ animationDelay: "80ms" }}>
                    <span className="text-[13px] font-semibold text-foreground">Editor Features</span>
                    <div className="rounded-lg border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] mt-2">
                        <SettingRow label="LSP Connect" description="Connects to Roblox for in-game properties and syntax highlighting">
                            <Switch checked={settings.lspConnect} onCheckedChange={(v) => update({ lspConnect: v })} />
                        </SettingRow>
                        <SettingRow label="Bracket Pair Colorization">
                            <Switch checked={settings.bracketPairColorization} onCheckedChange={(v) => update({ bracketPairColorization: v })} />
                        </SettingRow>
                        <SettingRow label="Word Wrap">
                            <Switch checked={settings.wordWrap} onCheckedChange={(v) => update({ wordWrap: v })} />
                        </SettingRow>
                        <SettingRow label="Line Numbers">
                            <Switch checked={settings.lineNumbers} onCheckedChange={(v) => update({ lineNumbers: v })} />
                        </SettingRow>
                        <SettingRow label="Auto Suggestions" description="Show autocomplete suggestions while typing">
                            <Switch checked={settings.autoSuggestions} onCheckedChange={(v) => update({ autoSuggestions: v })} />
                        </SettingRow>
                    </div>
                </section>

                {/* Execution */}
                <section className="space-y-1 animate-fade-slide-up" style={{ animationDelay: "120ms" }}>
                    <span className="text-[13px] font-semibold text-foreground">Execution</span>
                    <div className="rounded-lg border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] mt-2">
                        <SettingRow label="Auto Execute" description="Run saved scripts automatically on inject">
                            <Switch checked={settings.autoExec} onCheckedChange={(v) => update({ autoExec: v })} />
                        </SettingRow>
                        <SettingRow label="Unlock FPS" description="Remove the 60 FPS frame rate cap">
                            <Switch checked={settings.unlockFPS} onCheckedChange={(v) => update({ unlockFPS: v })} />
                        </SettingRow>
                        <SettingRow label="Debug Mode" description="Show execution logs in the console">
                            <Switch checked={settings.debugMode} onCheckedChange={(v) => update({ debugMode: v })} />
                        </SettingRow>
                        <SettingRow label="Redirect Console to UI" description="Forward print/warn/error output from instances">
                            <Switch checked={settings.redirectConsole} onCheckedChange={(v) => update({ redirectConsole: v })} />
                        </SettingRow>
                    </div>
                </section>

                {/* Notifications */}
                <section className="space-y-1 animate-fade-slide-up" style={{ animationDelay: "140ms" }}>
                    <span className="text-[13px] font-semibold text-foreground">Notifications</span>
                    <div className="rounded-lg border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] mt-2">
                        <SettingRow label="Join Notifications" description="Show a popup when an account joins a server">
                            <Switch checked={settings.joinNotifications} onCheckedChange={(v) => update({ joinNotifications: v })} />
                        </SettingRow>
                        <SettingRow label="Notification Duration" description={`${settings.joinNotificationDuration}s`}>
                            <Slider
                                className="w-[100px]"
                                min={3}
                                max={15}
                                step={1}
                                value={settings.joinNotificationDuration}
                                onValueChange={(v) => update({ joinNotificationDuration: typeof v === 'number' ? v : v[0] })}
                            />
                        </SettingRow>
                    </div>
                </section>

                {/* Window */}
                <section className="space-y-1 animate-fade-slide-up" style={{ animationDelay: "160ms" }}>
                    <span className="text-[13px] font-semibold text-foreground">Window</span>
                    <div className="rounded-lg border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] mt-2">
                        <SettingRow label="Always on Top" description="Keep the executor window above all others">
                            <Switch checked={settings.topMost} onCheckedChange={(v) => update({ topMost: v })} />
                        </SettingRow>
                        <SettingRow label="Opacity" description={`${settings.opacity}%`}>
                            <Slider
                                className="w-[100px]"
                                min={30}
                                max={100}
                                step={5}
                                value={settings.opacity}
                                onValueChange={(v) => update({ opacity: typeof v === 'number' ? v : v[0] })}
                            />
                        </SettingRow>
                    </div>
                </section>

                {/* ─── Synapse Z Settings ─── */}
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-[1.5px] border-b border-white/[0.06] pb-2 pt-2">
                    Synapse Z Settings
                </div>

                {synLoaded && (
                    <>
                        {/* Execution Method */}
                        <section className="space-y-1 animate-fade-slide-up" style={{ animationDelay: "180ms" }}>
                            <span className="text-[13px] font-semibold text-foreground">Execution Method</span>
                            <div className="rounded-lg border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] mt-2">
                                <SettingRow label="Method" description="How scripts are sent to Synapse Z">
                                    <div className="flex gap-1">
                                        {(["piper", "scheduler"] as const).map((m) => (
                                            <button
                                                key={m}
                                                onClick={() => update({ executionMethod: m })}
                                                className={cn(
                                                    "px-3 py-1 rounded-md text-[11px] font-medium border transition-all capitalize",
                                                    settings.executionMethod === m
                                                        ? "bg-white/[0.12] border-white/[0.2] text-foreground"
                                                        : "bg-white/[0.03] border-white/[0.06] text-muted-foreground hover:bg-white/[0.06]"
                                                )}
                                            >
                                                {m === "piper" ? "Piper" : "Scheduler"}
                                            </button>
                                        ))}
                                    </div>
                                </SettingRow>
                            </div>
                        </section>

                        {/* Internal UI Key */}
                        <section className="space-y-1 animate-fade-slide-up" style={{ animationDelay: "200ms" }}>
                            <span className="text-[13px] font-semibold text-foreground">Keybind</span>
                            <div className="rounded-lg border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] mt-2">
                                <SettingRow label="Internal UI Key" description="Hotkey to toggle the Synapse Z internal UI">
                                    <select
                                        value={synSettings.internal_ui_key}
                                        onChange={(e) => updateSyn({ internal_ui_key: e.target.value })}
                                        className="px-3 py-1 rounded-md text-[11px] font-mono border bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground transition-all min-w-[100px] cursor-pointer outline-none appearance-none"
                                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: '24px' }}
                                    >
                                        {SUPPORTED_KEYS.map((k) => (
                                            <option key={k} value={k}>{k}</option>
                                        ))}
                                    </select>
                                </SettingRow>
                            </div>
                        </section>

                        {/* Feature Toggles */}
                        <section className="space-y-1 animate-fade-slide-up" style={{ animationDelay: "200ms" }}>
                            <span className="text-[13px] font-semibold text-foreground">Features</span>
                            <div className="rounded-lg border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] mt-2">
                                <SettingRow label="Disable Purchases" description="Block in-game purchase prompts">
                                    <Switch checked={synSettings.disable_purchases} onCheckedChange={(v) => updateSyn({ disable_purchases: v })} />
                                </SettingRow>
                                <SettingRow label="Beta App Execution" description="Use the beta execution pipeline">
                                    <Switch checked={synSettings.beta_app_execution} onCheckedChange={(v) => updateSyn({ beta_app_execution: v })} />
                                </SettingRow>
                                <SettingRow label="Enable SetFFlag" description="Allow setting Fast Flags">
                                    <Switch checked={synSettings.enable_setfflag} onCheckedChange={(v) => updateSyn({ enable_setfflag: v })} />
                                </SettingRow>
                                <SettingRow label="Enable RakNet" description="Enable RakNet networking functions">
                                    <Switch checked={synSettings.enable_raknet} onCheckedChange={(v) => updateSyn({ enable_raknet: v })} />
                                </SettingRow>
                                <SettingRow label="Enable ReplicateSignal" description="Allow signal replication">
                                    <Switch checked={synSettings.enable_replicatesignal} onCheckedChange={(v) => updateSyn({ enable_replicatesignal: v })} />
                                </SettingRow>
                                <SettingRow label="Enable CFireSignal" description="Allow client fire signal">
                                    <Switch checked={synSettings.enable_cfiresignal} onCheckedChange={(v) => updateSyn({ enable_cfiresignal: v })} />
                                </SettingRow>
                            </div>
                        </section>

                        {/* DEX Settings */}
                        <section className="space-y-1 animate-fade-slide-up" style={{ animationDelay: "220ms" }}>
                            <span className="text-[13px] font-semibold text-foreground">DEX Explorer</span>
                            <div className="rounded-lg border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] mt-2">
                                <SettingRow label="Display Hidden" description="Show hidden instances in DEX">
                                    <Switch checked={synSettings.internal_ui_dex_display_hidden} onCheckedChange={(v) => updateSyn({ internal_ui_dex_display_hidden: v })} />
                                </SettingRow>
                                <SettingRow label="Display NotScriptable" description="Show non-scriptable properties">
                                    <Switch checked={synSettings.internal_ui_dex_display_notscriptable} onCheckedChange={(v) => updateSyn({ internal_ui_dex_display_notscriptable: v })} />
                                </SettingRow>
                            </div>
                        </section>

                        {/* UI Tuning */}
                        <section className="space-y-1 animate-fade-slide-up" style={{ animationDelay: "240ms" }}>
                            <span className="text-[13px] font-semibold text-foreground">UI Tuning</span>
                            <div className="rounded-lg border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04] mt-2">
                                <SettingRow label="UI Scaling" description={`${synSettings.internal_ui_scaling.toFixed(1)}x`}>
                                    <Slider
                                        className="w-[100px]"
                                        min={0.5}
                                        max={3.0}
                                        step={0.1}
                                        value={synSettings.internal_ui_scaling}
                                        onValueChange={(v) => updateSyn({ internal_ui_scaling: typeof v === 'number' ? v : v[0] })}
                                    />
                                </SettingRow>
                                <SettingRow label="Highlighting Fuzz" description={`${synSettings.internal_ui_highlighting_fuzz_score.toFixed(0)}`}>
                                    <Slider
                                        className="w-[100px]"
                                        min={0}
                                        max={100}
                                        step={1}
                                        value={synSettings.internal_ui_highlighting_fuzz_score}
                                        onValueChange={(v) => updateSyn({ internal_ui_highlighting_fuzz_score: typeof v === 'number' ? v : v[0] })}
                                    />
                                </SettingRow>
                            </div>
                        </section>
                    </>
                )}

            </div>
        </div>
    );
}

/* Compact setting row */
function SettingRow({
    label,
    description,
    children,
}: {
    label: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors duration-150">
            <div className="flex flex-col mr-4">
                <span className="text-[12px] font-medium text-foreground">{label}</span>
                {description && <span className="text-[10px] text-muted-foreground">{description}</span>}
            </div>
            {children}
        </div>
    );
}
