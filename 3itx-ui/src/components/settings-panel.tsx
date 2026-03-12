"use client";

import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

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
    joinNotifications: boolean;
    joinNotificationDuration: number;
    opacity: number;
    editorFont: number;
    theme: string;
}

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

export default function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
    const update = (partial: Partial<ExecutorSettings>) =>
        onChange({ ...settings, ...partial });

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
