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
    rovalraRegion?: string; // Region code for Rovalra API (e.g. "US-VIRGINIA", "SG")
}

interface RovalraServer {
    server_id: string;
    city: string;
    country: string;
    region: string;
    datacenter_id: number;
    ip_address: string;
    place_version: number;
}

interface HoverInfo {
    active: boolean;
    regionCode?: string;
    city?: string;
    country?: string;
    serverCount?: number;
    x?: number;
    y?: number;
}

interface RegionsPanelProps {
    clients: ClientInfo[];
    selectedPids: Set<number>;
}

// Map Rovalra region codes to datacenter marker codes for globe matching
// Rovalra uses codes like "US-VIRGINIA", "SG", "DE" while the globe uses datacenter-based codes
function findMatchingDatacenter(rovalraRegion: string, rovalraCity: string, dcMarkers: RegionMarker[]): RegionMarker | null {
    // Try to find by city name match
    const cityNormalized = rovalraCity.toLowerCase();
    return dcMarkers.find(m => m.city.toLowerCase() === cityNormalized) || null;
}

export default function RegionsPanel({ clients, selectedPids }: RegionsPanelProps) {
    // ─── State ───
    const [selectedAccountPid, setSelectedAccountPid] = useState<number | null>(null);
    const [placeId, setPlaceId] = useState("");
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [dcMarkers, setDcMarkers] = useState<RegionMarker[]>([]);
    const [globeReady, setGlobeReady] = useState(false);
    const [hover, setHover] = useState<HoverInfo>({ active: false });
    const [selectedRegion, setSelectedRegion] = useState<{ code: string; city: string; countryName: string; rovalraRegion: string } | null>(null);
    const [servers, setServers] = useState<RovalraServer[]>([]);
    const [loadingServers, setLoadingServers] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [teleporting, setTeleporting] = useState<string | null>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);

    const globeContainerRef = useRef<HTMLDivElement>(null);
    const scriptLoadedRef = useRef(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const dcMarkersRef = useRef<RegionMarker[]>([]);
    const placeIdRef = useRef(placeId);
    const fetchServersRef = useRef<(region: { code: string; rovalraRegion: string; city: string; countryName: string }) => void>(() => { });

    // Keep refs in sync
    useEffect(() => { dcMarkersRef.current = dcMarkers; }, [dcMarkers]);
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
                        const code = `${country}-${dc.location.region}-${dc.location_id}`;
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
                        };
                    });

                setDcMarkers(markers);
                dcMarkersRef.current = markers;

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

                // Build serverCounts (start at 0 — will update when Rovalra counts are fetched)
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

                await new Promise(r => setTimeout(r, 100));

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
            const marker = dcMarkersRef.current.find(m => m.code === regionCode);
            if (marker) {
                // Find the Rovalra region code for this datacenter marker
                const rovalraRegion = findRovalraRegionForMarker(marker);
                const regionInfo = {
                    code: marker.code,
                    city: marker.city,
                    countryName: marker.countryName,
                    rovalraRegion,
                };
                setSelectedRegion(regionInfo);
                fetchServersRef.current(regionInfo);
            }
        };

        document.addEventListener("rovalraGlobeHover", onHover);
        document.addEventListener("rovalraRegionSelected", onRegionSelect);
        return () => {
            document.removeEventListener("rovalraGlobeHover", onHover);
            document.removeEventListener("rovalraRegionSelected", onRegionSelect);
        };
    }, []);

    // ─── Map datacenter marker to Rovalra region ───
    // Rovalra uses region codes like "US-VIRGINIA", "SG", "DE", "JP", etc.
    const rovalraRegionMapRef = useRef<Record<string, string>>({});

    function findRovalraRegionForMarker(marker: RegionMarker): string {
        if (marker.rovalraRegion) return marker.rovalraRegion;
        // Try to find a matching rovalra region from the cached region map
        const cached = rovalraRegionMapRef.current;
        for (const [rovalraCode] of Object.entries(cached)) {
            // Direct code match (e.g. marker code starts with "US-" and rovalra is "US-VIRGINIA")
            if (marker.code.startsWith(marker.country + "-")) {
                const rovalraKey = Object.keys(cached).find(k => {
                    const cityInCached = cached[k];
                    return cityInCached && marker.city.toLowerCase() === cityInCached.toLowerCase();
                });
                if (rovalraKey) return rovalraKey;
            }
        }
        // Fallback: try simple country code (for non-US regions like "SG", "DE", "JP")
        if (!marker.country.startsWith("US") && cached[marker.country]) {
            return marker.country;
        }
        return marker.country;
    }

    // ─── Fetch Rovalra counts when placeId changes → update globe ───
    const lastProbedPlaceId = useRef("");
    useEffect(() => {
        if (lastProbedPlaceId.current && lastProbedPlaceId.current !== placeId) {
            setSelectedRegion(null);
            setServers([]);
            document.dispatchEvent(new CustomEvent('rovalraGlobePanelClosed'));
        }
        lastProbedPlaceId.current = placeId;
    }, [placeId]);

    useEffect(() => {
        if (!placeId.trim() || !globeReady) return;
        let cancelled = false;

        const fetchCounts = async () => {
            try {
                const res = await fetch(`/api/servers?placeId=${placeId}`);
                const data = await res.json();
                if (cancelled || data.status !== "success") return;

                const detailedRegions: Record<string, { cities: Record<string, number>; total_servers: number }> = data.counts?.detailed_regions || {};

                // Build a city→rovalraRegion map for later lookups
                const cityToRegion: Record<string, string> = {};
                for (const [regionCode, regionData] of Object.entries(detailedRegions)) {
                    for (const cityName of Object.keys(regionData.cities)) {
                        cityToRegion[cityName.toLowerCase()] = regionCode;
                    }
                    rovalraRegionMapRef.current[regionCode] = Object.keys(regionData.cities)[0] || "";
                }

                // Map Rovalra region counts to datacenter-based globe marker codes
                const dcs = dcMarkersRef.current;
                const serverCounts: Record<string, number> = {};
                for (const dc of dcs) {
                    const rovalraCode = cityToRegion[dc.city.toLowerCase()];
                    if (rovalraCode && detailedRegions[rovalraCode]) {
                        serverCounts[dc.code] = detailedRegions[rovalraCode].cities[dc.city] || detailedRegions[rovalraCode].total_servers;
                        dc.rovalraRegion = rovalraCode;
                    } else {
                        serverCounts[dc.code] = 0;
                    }
                }

                document.dispatchEvent(new CustomEvent('rovalraGlobe_UpdateData', {
                    detail: { serverCounts }
                }));
            } catch (err) {
                console.error("[Regions] Failed to fetch counts:", err);
            }
        };

        fetchCounts();
        return () => { cancelled = true; };
    }, [placeId, globeReady, dcMarkers]);

    // ─── Fetch servers for a selected region ───
    const fetchServers = useCallback(async (region: { code: string; rovalraRegion: string; city: string; countryName: string }) => {
        const currentPlaceId = placeIdRef.current;
        if (!currentPlaceId.trim()) return;
        setLoadingServers(true);
        setServers([]);
        setNextCursor(null);

        try {
            const res = await fetch(`/api/servers?placeId=${currentPlaceId}&region=${encodeURIComponent(region.rovalraRegion)}`);
            const data = await res.json();

            if (data.status === "success" && Array.isArray(data.servers)) {
                setServers(data.servers);
                setNextCursor(data.next_cursor || null);
            } else {
                setServers([]);
            }
        } catch (err) {
            console.error("[Regions] Failed to fetch servers:", err);
            setServers([]);
        } finally {
            setLoadingServers(false);
        }
    }, []);

    // ─── Load more servers (next page) ───
    const loadMoreServers = useCallback(async () => {
        if (!nextCursor || loadingMore || !selectedRegion) return;
        const currentPlaceId = placeIdRef.current;
        if (!currentPlaceId.trim()) return;
        setLoadingMore(true);

        try {
            const res = await fetch(`/api/servers?placeId=${currentPlaceId}&region=${encodeURIComponent(selectedRegion.rovalraRegion)}&cursor=${encodeURIComponent(nextCursor)}`);
            const data = await res.json();

            if (data.status === "success" && Array.isArray(data.servers)) {
                setServers(prev => [...prev, ...data.servers]);
                setNextCursor(data.next_cursor || null);
            }
        } catch (err) {
            console.error("[Regions] Failed to load more servers:", err);
        } finally {
            setLoadingMore(false);
        }
    }, [nextCursor, loadingMore, selectedRegion]);

    // Intersection observer for infinite scroll
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) loadMoreServers();
            },
            { threshold: 0.1 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [loadMoreServers, nextCursor]);

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
    const handleTeleport = useCallback(async (server: RovalraServer) => {
        if (!selectedAccountPid || !placeId.trim()) return;

        setTeleporting(server.server_id);
        const script = `game:GetService("TeleportService"):TeleportToPlaceInstance(${placeId}, "${server.server_id}")`;
        await fsBridge.executeOnClients([selectedAccountPid], script);

        setTimeout(() => setTeleporting(null), 2000);
    }, [selectedAccountPid, placeId]);

    // ─── Close server panel ───
    const handleCloseServers = useCallback(() => {
        setSelectedRegion(null);
        setServers([]);
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
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[8px] text-muted-foreground/60">{hover.country}</span>
                                    {(hover.serverCount != null && hover.serverCount > 0) && (
                                        <span className="text-[8px] text-blue-400/80 font-medium">
                                            {hover.serverCount.toLocaleString()} server{hover.serverCount !== 1 ? "s" : ""}
                                        </span>
                                    )}
                                </div>
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
                                            key={server.server_id || idx}
                                            className="group rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] p-2 transition-all"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] text-foreground font-medium">
                                                            {server.city}
                                                        </span>
                                                        <span className="text-[8px] text-muted-foreground/40">
                                                            DC {server.datacenter_id}
                                                        </span>
                                                    </div>
                                                    <div className="text-[7px] text-muted-foreground/30 truncate mt-0.5 font-mono">
                                                        {server.server_id}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleTeleport(server)}
                                                    disabled={!selectedAccountPid || teleporting === server.server_id}
                                                    className={cn(
                                                        "shrink-0 h-6 px-2 flex items-center gap-1 rounded text-[9px] font-medium transition-all",
                                                        teleporting === server.server_id
                                                            ? "bg-emerald-500/20 text-emerald-400 cursor-wait"
                                                            : "bg-white/[0.06] text-muted-foreground hover:bg-white/[0.12] hover:text-foreground",
                                                        !selectedAccountPid && "opacity-40 cursor-not-allowed"
                                                    )}
                                                >
                                                    {teleporting === server.server_id ? (
                                                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                                    ) : (
                                                        <ArrowRight className="w-2.5 h-2.5" />
                                                    )}
                                                    {teleporting === server.server_id ? "Joining..." : "Join"}
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                                {/* Scroll sentinel for infinite scroll */}
                                {nextCursor && (
                                    <div
                                        ref={sentinelRef}
                                        className="flex items-center justify-center py-3"
                                    >
                                        {loadingMore ? (
                                            <Loader2 className="w-3.5 h-3.5 text-muted-foreground/40 animate-spin" />
                                        ) : (
                                            <span className="text-[8px] text-muted-foreground/30">Scroll for more</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </ScrollArea>

                        {/* Region stats footer */}
                        <div className="px-3 py-2 border-t border-white/[0.06] shrink-0">
                            <div className="flex items-center justify-between">
                                <span className="text-[8px] text-muted-foreground/40">
                                    {servers.length} server{servers.length !== 1 ? "s" : ""} found
                                </span>
                                <span className="text-[8px] text-muted-foreground/30">
                                    {selectedRegion.city}, {selectedRegion.countryName}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
