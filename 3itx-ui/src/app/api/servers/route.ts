import { NextRequest, NextResponse } from "next/server";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ROVALRA_BASE = "https://apis.rovalra.com/v1";

export async function GET(req: NextRequest) {
    const placeId = req.nextUrl.searchParams.get("placeId");
    const region = req.nextUrl.searchParams.get("region");

    if (!placeId) {
        return NextResponse.json({ error: "Missing placeId" }, { status: 400 });
    }

    try {
        if (region) {
            // Fetch servers in a specific region
            const url = `${ROVALRA_BASE}/get_servers_in_region?place_id=${placeId}&region=${encodeURIComponent(region)}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) {
                return NextResponse.json({ error: `Rovalra returned ${res.status}` }, { status: 502 });
            }
            const data = await res.json();
            return NextResponse.json(data);
        } else {
            // Fetch server counts per region
            const url = `${ROVALRA_BASE}/servers/counts?place_id=${placeId}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) {
                return NextResponse.json({ error: `Rovalra returned ${res.status}` }, { status: 502 });
            }
            const data = await res.json();
            return NextResponse.json(data);
        }
    } catch (err) {
        console.error("[API/servers] Failed:", err);
        return NextResponse.json({ error: "Failed to fetch servers" }, { status: 502 });
    }
}
