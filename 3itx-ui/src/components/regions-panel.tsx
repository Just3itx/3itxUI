"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Globe, ChevronDown, Search, Users, Loader2, ArrowRight, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import * as fsBridge from "@/lib/fs-bridge";
import type { ClientInfo } from "@/components/account-manager";

/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Country → Continent mapping ───
const COUNTRY_CONTINENT_MAP: Record<string, string> = {
    'AF': 'Asia', 'AX': 'Europe', 'AL': 'Europe', 'DZ': 'Africa', 'AS': 'Oceania', 'AD': 'Europe',
    'AO': 'Africa', 'AI': 'North America', 'AQ': 'Antarctica', 'AG': 'North America', 'AR': 'South America',
    'AM': 'Asia', 'AW': 'North America', 'AU': 'Oceania', 'AT': 'Europe', 'AZ': 'Asia', 'BS': 'North America',
    'BH': 'Asia', 'BD': 'Asia', 'BB': 'North America', 'BY': 'Europe', 'BE': 'Europe', 'BZ': 'North America',
    'BJ': 'Africa', 'BM': 'North America', 'BT': 'Asia', 'BO': 'South America', 'BQ': 'North America',
    'BA': 'Europe', 'BW': 'Africa', 'BV': 'Antarctica', 'BR': 'South America', 'IO': 'Asia', 'BN': 'Asia',
    'BG': 'Europe', 'BF': 'Africa', 'BI': 'Africa', 'CV': 'Africa', 'KH': 'Asia', 'CM': 'Africa',
    'CA': 'North America', 'KY': 'North America', 'CF': 'Africa', 'TD': 'Africa', 'CL': 'South America',
    'CN': 'Asia', 'CX': 'Asia', 'CC': 'Asia', 'CO': 'South America', 'KM': 'Africa', 'CG': 'Africa',
    'CD': 'Africa', 'CK': 'Oceania', 'CR': 'North America', 'CI': 'Africa', 'HR': 'Europe', 'CU': 'North America',
    'CW': 'North America', 'CY': 'Asia', 'CZ': 'Europe', 'DK': 'Europe', 'DJ': 'Africa', 'DM': 'North America',
    'DO': 'North America', 'EC': 'South America', 'EG': 'Africa', 'SV': 'North America', 'GQ': 'Africa',
    'ER': 'Africa', 'EE': 'Europe', 'SZ': 'Africa', 'ET': 'Africa', 'FK': 'South America', 'FO': 'Europe',
    'FJ': 'Oceania', 'FI': 'Europe', 'FR': 'Europe', 'GF': 'South America', 'PF': 'Oceania', 'TF': 'Antarctica',
    'GA': 'Africa', 'GM': 'Africa', 'GE': 'Asia', 'DE': 'Europe', 'GH': 'Africa', 'GI': 'Europe', 'GR': 'Europe',
    'GL': 'North America', 'GD': 'North America', 'GP': 'North America', 'GU': 'Oceania', 'GT': 'North America',
    'GG': 'Europe', 'GN': 'Africa', 'GW': 'Africa', 'GY': 'South America', 'HT': 'North America', 'HM': 'Antarctica',
    'VA': 'Europe', 'HN': 'North America', 'HK': 'Asia', 'HU': 'Europe', 'IS': 'Europe', 'IN': 'Asia', 'ID': 'Asia',
    'IR': 'Asia', 'IQ': 'Asia', 'IE': 'Europe', 'IM': 'Europe', 'IL': 'Asia', 'IT': 'Europe', 'JM': 'North America',
    'JP': 'Asia', 'JE': 'Europe', 'JO': 'Asia', 'KZ': 'Asia', 'KE': 'Africa', 'KI': 'Oceania', 'KP': 'Asia',
    'KR': 'Asia', 'KW': 'Asia', 'KG': 'Asia', 'LA': 'Asia', 'LV': 'Europe', 'LB': 'Asia', 'LS': 'Africa',
    'LR': 'Africa', 'LY': 'Africa', 'LI': 'Europe', 'LT': 'Europe', 'LU': 'Europe', 'MO': 'Asia', 'MG': 'Africa',
    'MW': 'Africa', 'MY': 'Asia', 'MV': 'Asia', 'ML': 'Africa', 'MT': 'Europe', 'MH': 'Oceania', 'MQ': 'North America',
    'MR': 'Africa', 'MU': 'Africa', 'YT': 'Africa', 'MX': 'North America', 'FM': 'Oceania', 'MD': 'Europe',
    'MC': 'Europe', 'MN': 'Asia', 'ME': 'Europe', 'MS': 'North America', 'MA': 'Africa', 'MZ': 'Africa',
    'MM': 'Asia', 'NA': 'Africa', 'NR': 'Oceania', 'NP': 'Asia', 'NL': 'Europe', 'NC': 'Oceania', 'NZ': 'Oceania',
    'NI': 'North America', 'NE': 'Africa', 'NG': 'Africa', 'NU': 'Oceania', 'NF': 'Oceania', 'MK': 'Europe',
    'MP': 'Oceania', 'NO': 'Europe', 'OM': 'Asia', 'PK': 'Asia', 'PW': 'Oceania', 'PS': 'Asia', 'PA': 'North America',
    'PG': 'Oceania', 'PY': 'South America', 'PE': 'South America', 'PH': 'Asia', 'PN': 'Oceania', 'PL': 'Europe',
    'PT': 'Europe', 'PR': 'North America', 'QA': 'Asia', 'RE': 'Africa', 'RO': 'Europe', 'RU': 'Europe', 'RW': 'Africa',
    'BL': 'North America', 'SH': 'Africa', 'KN': 'North America', 'LC': 'North America', 'MF': 'North America',
    'PM': 'North America', 'VC': 'North America', 'WS': 'Oceania', 'SM': 'Europe', 'ST': 'Africa', 'SA': 'Asia',
    'SN': 'Africa', 'RS': 'Europe', 'SC': 'Africa', 'SL': 'Africa', 'SG': 'Asia', 'SX': 'North America', 'SK': 'Europe',
    'SI': 'Europe', 'SB': 'Oceania', 'SO': 'Africa', 'ZA': 'Africa', 'GS': 'Antarctica', 'SS': 'Africa', 'ES': 'Europe',
    'LK': 'Asia', 'SD': 'Africa', 'SR': 'South America', 'SJ': 'Europe', 'SE': 'Europe', 'CH': 'Europe', 'SY': 'Asia',
    'TW': 'Asia', 'TJ': 'Asia', 'TZ': 'Africa', 'TH': 'Asia', 'TL': 'Asia', 'TG': 'Africa', 'TK': 'Oceania',
    'TO': 'Oceania', 'TT': 'North America', 'TN': 'Africa', 'TR': 'Asia', 'TM': 'Asia', 'TC': 'North America',
    'TV': 'Oceania', 'UG': 'Africa', 'UA': 'Europe', 'AE': 'Asia', 'GB': 'Europe', 'US': 'North America',
    'UM': 'Oceania', 'UY': 'South America', 'UZ': 'Asia', 'VU': 'Oceania', 'VE': 'South America', 'VN': 'Asia',
    'VG': 'North America', 'VI': 'North America', 'WF': 'Oceania', 'EH': 'Africa', 'YE': 'Asia', 'ZM': 'Africa',
    'ZW': 'Africa'
};

const STATE_MAP: Record<string, string> = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
    'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
    'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
    'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
    'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
    'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
    'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
    'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
    'Hesse': 'HE'
};

// ─── Types ───
interface Datacenter {
    location_id: number;
    dataCenterIds: number[];
    location: {
        city: string;
        region: string;
        country: string;
        country_name: string;
        latLong: [string, string];
    };
    inactive: boolean;
    loadbalancing: boolean;
}

interface RegionMarker {
    code: string;
    city: string;
    country: string;
    countryName: string;
    continent: string;
    coords: { lat: number; lon: number };
    dataCenterIds: number[];
}

interface ServerInfo {
    id: string;
    playing: number;
    maxPlayers: number;
    fps: number;
    ping: number;
    dataCenterId: number | null;
}

interface HoverInfo {
    active: boolean;
    regionCode?: string;
    city?: string;
    country?: string;
    x?: number;
    y?: number;
}

interface RegionsPanelProps {
    clients: ClientInfo[];
    selectedPids: Set<number>;
}

export default function RegionsPanel({ clients, selectedPids }: RegionsPanelProps) {
    // ─── State ───
    const [selectedAccountPid, setSelectedAccountPid] = useState<number | null>(null);
    const [placeId, setPlaceId] = useState("");
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [datacenters, setDatacenters] = useState<RegionMarker[]>([]);
    const [globeReady, setGlobeReady] = useState(false);
    const [hover, setHover] = useState<HoverInfo>({ active: false });
    const [selectedRegion, setSelectedRegion] = useState<RegionMarker | null>(null);
    const [servers, setServers] = useState<ServerInfo[]>([]);
    const [loadingServers, setLoadingServers] = useState(false);
    const [teleporting, setTeleporting] = useState<string | null>(null);

    const globeContainerRef = useRef<HTMLDivElement>(null);
    const scriptLoadedRef = useRef(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const datacentersRef = useRef<RegionMarker[]>([]);
    const placeIdRef = useRef(placeId);
    const fetchServersRef = useRef<(region: RegionMarker) => void>(() => { });

    // Keep refs in sync
    useEffect(() => { datacentersRef.current = datacenters; }, [datacenters]);
    useEffect(() => { placeIdRef.current = placeId; }, [placeId]);

    // Auto-select first connected client
    useEffect(() => {
        if (selectedAccountPid === null && clients.length > 0) {
            const first = clients.find(c => selectedPids.has(c.pid)) || clients[0];
            setSelectedAccountPid(first.pid);
            if (first.placeId && first.placeId > 0) {
                setPlaceId(String(first.placeId));
            }
        } else if (selectedAccountPid !== null) {
            // Update placeId when selected client switches games
            const selectedClient = clients.find(c => c.pid === selectedAccountPid);
            if (selectedClient && selectedClient.placeId && selectedClient.placeId > 0) {
                const newPlaceId = String(selectedClient.placeId);
                if (newPlaceId !== placeId) {
                    setPlaceId(newPlaceId);
                }
            }
        }
    }, [clients, selectedPids, selectedAccountPid, placeId]);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // ─── Fetch datacenters & init globe ───
    useEffect(() => {
        let cancelled = false;

        async function init() {
            try {
                const res = await fetch("https://apis.rovalra.com/v1/datacenters/list");
                const data: Datacenter[] = await res.json();
                if (cancelled) return;

                const markers: RegionMarker[] = data
                    .filter(dc => !dc.inactive)
                    .map(dc => {
                        const country = dc.location.country;
                        const continent = COUNTRY_CONTINENT_MAP[country] || "Unknown";
                        const regionCode = STATE_MAP[dc.location.region] || dc.location.region;
                        const code = `${country}-${regionCode}-${dc.location_id}`;
                        return {
                            code,
                            city: dc.location.city,
                            country: dc.location.country,
                            countryName: dc.location.country_name,
                            continent,
                            coords: {
                                lat: parseFloat(dc.location.latLong[0]),
                                lon: parseFloat(dc.location.latLong[1]),
                            },
                            dataCenterIds: dc.dataCenterIds,
                        };
                    });

                setDatacenters(markers);
                datacentersRef.current = markers;

                // Build REGIONS object grouped by continent
                const REGIONS: Record<string, Record<string, { city: string; country: string; coords: { lat: number; lon: number } }>> = {};
                for (const m of markers) {
                    if (!REGIONS[m.continent]) REGIONS[m.continent] = {};
                    REGIONS[m.continent][m.code] = {
                        city: m.city,
                        country: m.countryName,
                        coords: m.coords,
                    };
                }

                // Build serverCounts (start at 0 — will update when servers are scanned)
                const serverCounts: Record<string, number> = {};
                for (const m of markers) {
                    serverCounts[m.code] = 0;
                }

                // Load globe script if not already loaded
                if (!scriptLoadedRef.current) {
                    scriptLoadedRef.current = true;
                    await new Promise<void>((resolve) => {
                        const script = document.createElement("script");
                        script.src = "/globe_initializer.js";
                        script.onload = () => resolve();
                        script.onerror = () => resolve();
                        document.head.appendChild(script);
                    });
                }

                // Wait a tick for the script IIFE to register its event listener
                await new Promise(r => setTimeout(r, 100));

                // Dispatch init event
                document.dispatchEvent(
                    new CustomEvent("initRovalraGlobe", {
                        detail: {
                            REGIONS,
                            serverCounts,
                            mapUrl: "/map_dark.png",
                        },
                    })
                );

                setGlobeReady(true);
            } catch (err) {
                console.error("[Regions] Failed to load datacenters:", err);
            }
        }

        init();
        return () => { cancelled = true; };
    }, []);

    // ─── Globe event listeners ───
    useEffect(() => {
        const onHover = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            setHover(detail);
        };

        const onRegionSelect = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const regionCode = detail.regionCode;
            const marker = datacentersRef.current.find(m => m.code === regionCode);
            if (marker) {
                setSelectedRegion(marker);
                fetchServersRef.current(marker);
            }
        };

        document.addEventListener("rovalraGlobeHover", onHover);
        document.addEventListener("rovalraRegionSelected", onRegionSelect);
        return () => {
            document.removeEventListener("rovalraGlobeHover", onHover);
            document.removeEventListener("rovalraRegionSelected", onRegionSelect);
        };
    }, []);

    // ─── Fetch servers filtered by datacenter ───
    const selectedRegionRef = useRef<RegionMarker | null>(null);
    const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [scanning, setScanning] = useState(false);

    // Cleanup poll on unmount
    useEffect(() => {
        return () => { if (scanIntervalRef.current) clearInterval(scanIntervalRef.current); };
    }, []);

    // Reset panel when placeId changes
    const lastProbedPlaceId = useRef("");
    useEffect(() => {
        if (lastProbedPlaceId.current && lastProbedPlaceId.current !== placeId) {
            setSelectedRegion(null);
            setServers([]);
            selectedRegionRef.current = null;
            if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
            document.dispatchEvent(new CustomEvent('rovalraGlobePanelClosed'));
        }
        lastProbedPlaceId.current = placeId;
    }, [placeId]);

    // Auto-scan when placeId changes — lights up globe markers as datacenters are discovered
    const autoScanRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => {
        if (autoScanRef.current) { clearInterval(autoScanRef.current); autoScanRef.current = null; }
        if (!placeId.trim() || !globeReady) return;

        const updateGlobe = async () => {
            try {
                const res = await fetch(`/api/servers?placeId=${placeId}`);
                const data = await res.json();
                const allServers = (data.servers || []) as Array<{ dataCenterId: number | null }>;

                // Count servers per datacenter, then map to globe markers
                const dcCounts = new Map<number, number>();
                for (const s of allServers) {
                    if (s.dataCenterId != null) {
                        dcCounts.set(s.dataCenterId, (dcCounts.get(s.dataCenterId) || 0) + 1);
                    }
                }

                const dcs = datacentersRef.current;
                const serverCounts: Record<string, number> = {};
                for (const dc of dcs) {
                    const count = dc.dataCenterIds.reduce((sum, id) => sum + (dcCounts.get(id) || 0), 0);
                    serverCounts[dc.code] = count;
                }
                document.dispatchEvent(new CustomEvent('rovalraGlobe_UpdateData', {
                    detail: { serverCounts }
                }));

                if (!data.scanning && autoScanRef.current) {
                    clearInterval(autoScanRef.current);
                    autoScanRef.current = null;
                }
            } catch { /* ignore */ }
        };

        updateGlobe();
        autoScanRef.current = setInterval(updateGlobe, 4000);

        return () => { if (autoScanRef.current) { clearInterval(autoScanRef.current); autoScanRef.current = null; } };
    }, [placeId, globeReady, datacenters]);

    const fetchServers = useCallback(async (region: RegionMarker) => {
        const currentPlaceId = placeIdRef.current;
        if (!currentPlaceId.trim()) return;
        setLoadingServers(true);
        setServers([]);
        selectedRegionRef.current = region;

        // Stop existing poll
        if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }

        const doFetch = async (isInitial: boolean) => {
            try {
                const res = await fetch(`/api/servers?placeId=${currentPlaceId}`);
                const data = await res.json();

                const allServers: ServerInfo[] = data.servers || [];

                // Filter to servers matching this region's datacenter IDs
                const dcIds = new Set(region.dataCenterIds);
                const filtered = allServers.filter(s => s.dataCenterId != null && dcIds.has(s.dataCenterId));
                setServers(filtered);
                setScanning(!!data.scanning);

                if (!data.scanning && scanIntervalRef.current) {
                    clearInterval(scanIntervalRef.current);
                    scanIntervalRef.current = null;
                }
                return !!data.scanning;
            } catch (err) {
                console.error("[Regions] Failed to fetch servers:", err);
                if (isInitial) setServers([]);
                return false;
            } finally {
                if (isInitial) setLoadingServers(false);
            }
        };

        const stillScanning = await doFetch(true);

        if (stillScanning) {
            scanIntervalRef.current = setInterval(() => {
                if (selectedRegionRef.current?.code === region.code) {
                    doFetch(false);
                } else {
                    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
                }
            }, 4000);
        }
    }, []);

    // Keep fetchServersRef in sync
    useEffect(() => { fetchServersRef.current = fetchServers; }, [fetchServers]);

    // ─── Select account ───
    const handleSelectAccount = useCallback((client: ClientInfo) => {
        setSelectedAccountPid(client.pid);
        if (client.placeId && client.placeId > 0) {
            setPlaceId(String(client.placeId));
        }
        setDropdownOpen(false);
    }, []);

    // ─── Teleport to server ───
    const handleTeleport = useCallback(async (server: ServerInfo) => {
        if (!selectedAccountPid || !placeId.trim()) return;

        setTeleporting(server.id);
        const script = `game:GetService("TeleportService"):TeleportToPlaceInstance(${placeId}, "${server.id}")`;
        await fsBridge.executeOnClients([selectedAccountPid], script);

        setTimeout(() => setTeleporting(null), 2000);
    }, [selectedAccountPid, placeId]);

    // ─── Close server panel ───
    const handleCloseServers = useCallback(() => {
        setSelectedRegion(null);
        setServers([]);
        // Let globe know panel closed
        document.dispatchEvent(new CustomEvent("rovalraGlobePanelClosed"));
    }, []);

    // Currently selected client
    const selectedClient = clients.find(c => c.pid === selectedAccountPid);

    return (
        <div className="flex-1 flex flex-col overflow-hidden animate-panel-in">
            {/* Header */}
            <div className="flex items-center h-[36px] px-3 border-b border-white/[0.06] shrink-0">
                <Globe className="w-3.5 h-3.5 text-muted-foreground mr-2" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Regions
                </span>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] shrink-0">
                {/* Account Dropdown */}
                <div ref={dropdownRef} className="relative flex-1 min-w-0">
                    <button
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className={cn(
                            "w-full h-[30px] px-2.5 flex items-center gap-2 rounded-md border text-[10px] transition-all",
                            "bg-white/[0.03] border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.05]",
                            dropdownOpen && "border-white/[0.2] bg-white/[0.06]"
                        )}
                    >
                        {selectedClient ? (
                            <>
                                {selectedClient.avatarUrl && (
                                    <img
                                        src={selectedClient.avatarUrl}
                                        alt=""
                                        className="w-4 h-4 rounded-full shrink-0"
                                        draggable={false}
                                    />
                                )}
                                <span className="text-foreground truncate">
                                    {selectedClient.displayName}
                                </span>
                                <span className="text-muted-foreground/50 truncate">
                                    @{selectedClient.username}
                                </span>
                            </>
                        ) : (
                            <span className="text-muted-foreground/50">Select account...</span>
                        )}
                        <ChevronDown className={cn(
                            "w-3 h-3 text-muted-foreground/40 ml-auto shrink-0 transition-transform",
                            dropdownOpen && "rotate-180"
                        )} />
                    </button>

                    {/* Dropdown menu */}
                    {dropdownOpen && (
                        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[#141416] border border-white/[0.08] rounded-lg shadow-xl overflow-hidden animate-fade-slide-in">
                            {clients.length === 0 ? (
                                <div className="px-3 py-4 text-center text-[10px] text-muted-foreground/40">
                                    No clients connected
                                </div>
                            ) : (
                                <ScrollArea className="max-h-[200px]">
                                    {clients.map(client => (
                                        <button
                                            key={client.id}
                                            onClick={() => handleSelectAccount(client)}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.05] transition-colors",
                                                selectedAccountPid === client.pid && "bg-white/[0.06]"
                                            )}
                                        >
                                            <div className="w-5 h-5 rounded-full overflow-hidden bg-white/[0.06] shrink-0">
                                                {client.avatarUrl ? (
                                                    <img src={client.avatarUrl} alt="" className="w-full h-full object-cover" draggable={false} />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <Users className="w-2.5 h-2.5 text-muted-foreground/30" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[10px] text-foreground truncate">{client.displayName}</span>
                                                    <span className="text-[8px] text-muted-foreground/50">@{client.username}</span>
                                                </div>
                                                <span className="text-[8px] text-muted-foreground/40 truncate block">
                                                    {client.placeName || `Place ${client.placeId}`}
                                                </span>
                                            </div>
                                            {selectedAccountPid === client.pid && (
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                            )}
                                        </button>
                                    ))}
                                </ScrollArea>
                            )}
                        </div>
                    )}
                </div>

                {/* PlaceID Input */}
                <div className="relative w-[140px] shrink-0">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/30" />
                    <input
                        type="text"
                        value={placeId}
                        onChange={(e) => setPlaceId(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="Place ID..."
                        className="w-full h-[30px] pl-6 pr-2 text-[10px] bg-white/[0.03] border border-white/[0.08] rounded-md text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-white/[0.2] transition-colors"
                    />
                </div>
            </div>

            {/* Globe + Server Panel */}
            <div className="flex-1 flex overflow-hidden relative">
                {/* Globe */}
                <div className="flex-1 relative">
                    <div
                        ref={globeContainerRef}
                        id="rovalra-globe-container"
                        className="w-full h-full"
                    />

                    {/* Loading overlay */}
                    {!globeReady && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                            <div className="flex flex-col items-center gap-2">
                                <Loader2 className="w-6 h-6 text-muted-foreground/40 animate-spin" />
                                <span className="text-[10px] text-muted-foreground/40">Loading globe...</span>
                            </div>
                        </div>
                    )}

                    {/* Hover tooltip */}
                    {hover.active && hover.x != null && hover.y != null && (
                        <div
                            className="fixed z-[100] pointer-events-none"
                            style={{ left: hover.x, top: hover.y - 40 }}
                        >
                            <div className="bg-[#141416]/95 backdrop-blur-sm border border-white/[0.1] rounded-lg px-2.5 py-1.5 shadow-xl">
                                <div className="text-[10px] text-foreground font-medium">{hover.city}</div>
                                <div className="text-[8px] text-muted-foreground/60">{hover.country}</div>
                            </div>
                        </div>
                    )}

                    {/* No PlaceID hint */}
                    {globeReady && !placeId.trim() && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                                <span className="text-[9px] text-amber-400/80">Enter a Place ID to browse servers</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Server list panel (slides in from right) */}
                {selectedRegion && (
                    <div className="w-[280px] border-l border-white/[0.06] flex flex-col bg-background/80 backdrop-blur-sm animate-panel-in shrink-0 overflow-hidden">
                        {/* Server panel header */}
                        <div className="flex items-center h-[36px] px-3 border-b border-white/[0.06] shrink-0">
                            <div className="flex-1 min-w-0">
                                <span className="text-[10px] font-semibold text-foreground truncate">
                                    {selectedRegion.city}
                                </span>
                                <span className="text-[9px] text-muted-foreground/50 ml-1.5">
                                    {selectedRegion.countryName}
                                </span>
                            </div>
                            <button
                                onClick={handleCloseServers}
                                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.06] transition-colors"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>

                        {/* Server list */}
                        <ScrollArea className="flex-1 min-h-0">
                            <div className="p-2 space-y-1.5">
                                {loadingServers ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="w-4 h-4 text-muted-foreground/40 animate-spin" />
                                    </div>
                                ) : !placeId.trim() ? (
                                    <div className="text-center py-8">
                                        <span className="text-[9px] text-muted-foreground/40">Enter a Place ID first</span>
                                    </div>
                                ) : servers.length === 0 ? (
                                    <div className="text-center py-8">
                                        <Globe className="w-5 h-5 text-muted-foreground/15 mx-auto mb-2" />
                                        <span className="text-[9px] text-muted-foreground/40 block">No servers found</span>
                                        <span className="text-[8px] text-muted-foreground/25 block mt-0.5">Try a different region</span>
                                    </div>
                                ) : (
                                    servers.map((server, idx) => (
                                        <div
                                            key={server.id || idx}
                                            className="group rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] p-2 transition-all"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        {server.playing != null ? (
                                                            <>
                                                                <Users className="w-2.5 h-2.5 text-muted-foreground/40" />
                                                                <span className="text-[10px] text-foreground">
                                                                    {server.playing}/{server.maxPlayers}
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <span className="text-[10px] text-foreground font-medium">Server</span>
                                                        )}
                                                        {server.fps > 0 && (
                                                            <span className="text-[8px] text-muted-foreground/40">
                                                                {Math.round(server.fps)} FPS
                                                            </span>
                                                        )}
                                                        {server.ping > 0 && (
                                                            <span className="text-[8px] text-muted-foreground/40">
                                                                {Math.round(server.ping)}ms
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[7px] text-muted-foreground/30 truncate mt-0.5 font-mono">
                                                        {server.id}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleTeleport(server)}
                                                    disabled={!selectedAccountPid || teleporting === server.id}
                                                    className={cn(
                                                        "shrink-0 h-6 px-2 flex items-center gap-1 rounded text-[9px] font-medium transition-all",
                                                        teleporting === server.id
                                                            ? "bg-emerald-500/20 text-emerald-400 cursor-wait"
                                                            : "bg-white/[0.06] text-muted-foreground hover:bg-white/[0.12] hover:text-foreground",
                                                        !selectedAccountPid && "opacity-40 cursor-not-allowed"
                                                    )}
                                                >
                                                    {teleporting === server.id ? (
                                                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                                    ) : (
                                                        <ArrowRight className="w-2.5 h-2.5" />
                                                    )}
                                                    {teleporting === server.id ? "Joining..." : "Join"}
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </ScrollArea>

                        {/* Region stats footer */}
                        <div className="px-3 py-2 border-t border-white/[0.06] shrink-0">
                            <div className="flex items-center justify-between">
                                <span className="text-[8px] text-muted-foreground/40">
                                    {servers.length} server{servers.length !== 1 ? "s" : ""} found
                                </span>
                                <div className="flex items-center gap-1.5">
                                    {scanning && (
                                        <div className="flex items-center gap-1">
                                            <Loader2 className="w-2.5 h-2.5 text-blue-400/60 animate-spin" />
                                            <span className="text-[8px] text-blue-400/60">Scanning...</span>
                                        </div>
                                    )}
                                    <span className="text-[8px] text-muted-foreground/30">
                                        {selectedRegion.city}, {selectedRegion.countryName}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
