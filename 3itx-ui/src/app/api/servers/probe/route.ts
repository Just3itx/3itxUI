import { NextRequest, NextResponse } from "next/server";
import { decryptRobloxCookie, getCsrfToken, invalidateCsrf } from "@/lib/roblox-cookie";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Cache: jobId → server details
const probeCache = new Map<string, { ip: string; port: number; dataCenterId: number; region: string; countryCode: string }>();

// Roblox IP → location map (subnet prefix → location)
interface IpLocation { country: string; region: string; city: string }
let ipMap: Map<string, IpLocation> | null = null;
let ipMapExpiry = 0;

const IP_LIST_URL = "https://raw.githubusercontent.com/Just3itx/Roblox-Server-IP-List/refs/heads/main/List-9-11-25.json";

// Country name → 2-letter code
const COUNTRY_CODES: Record<string, string> = {
    "United States": "US", "Germany": "DE", "France": "FR", "Netherlands": "NL",
    "United Kingdom": "GB", "Singapore": "SG", "Japan": "JP", "Australia": "AU",
    "Brazil": "BR", "India": "IN", "South Korea": "KR", "Canada": "CA",
    "Poland": "PL", "Sweden": "SE", "Ireland": "IE", "Hong Kong": "HK",
    "Taiwan": "TW", "Indonesia": "ID", "Thailand": "TH", "Mexico": "MX",
    "Chile": "CL", "Argentina": "AR", "Colombia": "CO", "Peru": "PE",
    "Spain": "ES", "Italy": "IT", "Turkey": "TR", "South Africa": "ZA",
    "Finland": "FI", "Norway": "NO", "Denmark": "DK", "Belgium": "BE",
    "Switzerland": "CH", "Austria": "AT", "Czech Republic": "CZ", "Romania": "RO",
    "Portugal": "PT", "Greece": "GR", "Hungary": "HU", "Israel": "IL",
    "United Arab Emirates": "AE", "Saudi Arabia": "SA", "Philippines": "PH",
    "Malaysia": "MY", "Vietnam": "VN", "New Zealand": "NZ", "Pakistan": "PK",
    "Bangladesh": "BD", "Nigeria": "NG", "Egypt": "EG", "Kenya": "KE",
};

async function getIpMap(): Promise<Map<string, IpLocation>> {
    if (ipMap && Date.now() < ipMapExpiry) return ipMap;

    try {
        const res = await fetch(IP_LIST_URL, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
            const list: Array<{ ip: string; success: boolean; country: string; region: string; city: string }> = await res.json();
            const map = new Map<string, IpLocation>();
            for (const entry of list) {
                if (!entry.success || !entry.ip) continue;
                // Store by first 3 octets (subnet prefix)
                const parts = entry.ip.split(".");
                if (parts.length >= 3) {
                    const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
                    map.set(prefix, { country: entry.country, region: entry.region, city: entry.city });
                }
            }
            ipMap = map;
            ipMapExpiry = Date.now() + 30 * 60 * 1000; // cache 30 min
            return map;
        }
    } catch (err) {
        console.error("[API/probe] IP list fetch failed:", err);
    }
    return ipMap || new Map();
}

function lookupIp(ip: string, map: Map<string, IpLocation>): { region: string; countryCode: string } | null {
    const parts = ip.split(".");
    if (parts.length < 3) return null;
    const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const entry = map.get(prefix);
    if (!entry) return null;
    return {
        region: `${entry.city}, ${entry.region}`,
        countryCode: COUNTRY_CODES[entry.country] || entry.country.slice(0, 2).toUpperCase(),
    };
}

export async function GET(req: NextRequest) {
    const placeId = req.nextUrl.searchParams.get("placeId");
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!placeId || !jobId) {
        return NextResponse.json({ error: "Missing placeId or jobId" }, { status: 400 });
    }

    if (probeCache.has(jobId)) {
        return NextResponse.json({ ...probeCache.get(jobId)!, cached: true });
    }

    try {
        const cookie = await decryptRobloxCookie();
        if (!cookie) return NextResponse.json({ error: "No cookie" }, { status: 401 });
        const csrf = await getCsrfToken(cookie);
        if (!csrf) return NextResponse.json({ error: "No CSRF" }, { status: 401 });

        const res = await fetch("https://gamejoin.roblox.com/v1/join-game-instance", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cookie": `.ROBLOSECURITY=${cookie}`,
                "x-csrf-token": csrf,
                "Referer": "https://www.roblox.com",
                "Origin": "https://www.roblox.com",
                "User-Agent": "Roblox/WinInet",
            },
            body: JSON.stringify({
                placeId: parseInt(placeId, 10),
                gameId: jobId,
                gameJoinAttemptId: crypto.randomUUID(),
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (res.status === 403) {
            invalidateCsrf();
            return NextResponse.json({ error: "CSRF expired" }, { status: 403 });
        }
        if (!res.ok) {
            return NextResponse.json({ error: `Roblox returned ${res.status}` }, { status: 502 });
        }

        const data = await res.json();
        const js = data.joinScript;
        if (!js) {
            return NextResponse.json({ error: "No joinScript" }, { status: 502 });
        }

        const udmux = Array.isArray(js.UdmuxEndpoints) && js.UdmuxEndpoints.length > 0
            ? js.UdmuxEndpoints[0] : null;
        const ip = udmux?.Address || js.MachineAddress || "";
        const port = udmux?.Port || js.ServerPort || 0;
        const dataCenterId = js.DataCenterId || 0;

        // Look up region from curated Roblox IP list
        let region = "";
        let countryCode = "";
        if (ip) {
            const map = await getIpMap();
            const loc = lookupIp(ip, map);
            if (loc) {
                region = loc.region;
                countryCode = loc.countryCode;
            }

            // Fallback to ip-api.com if region is still unknown
            if (!region && !ip.startsWith("10.") && !ip.startsWith("192.168.")) {
                try {
                    const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=country,countryCode,regionName,city`, {
                        signal: AbortSignal.timeout(3000),
                    });
                    if (geoRes.ok) {
                        const geo = await geoRes.json();
                        region = geo.city ? `${geo.city}, ${geo.regionName || ""}`.replace(/, $/, "") : (geo.country || "");
                        countryCode = geo.countryCode || "";
                    }
                } catch { /* geo lookup failed, leave empty */ }
            }
        }

        const result = { ip, port, dataCenterId, region, countryCode };
        probeCache.set(jobId, result);
        return NextResponse.json(result);
    } catch (err) {
        console.error("[API/servers/probe] Failed:", err);
        return NextResponse.json({ error: "Probe failed" }, { status: 502 });
    }
}
