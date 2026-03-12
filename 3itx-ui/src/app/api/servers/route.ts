import { NextRequest, NextResponse } from "next/server";
import { decryptRobloxCookie, getCsrfToken, invalidateCsrf } from "@/lib/roblox-cookie";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── In-memory cache: jobId → dataCenterId ───
const dcCache = new Map<string, number>();

// ─── Background scan state per placeId ───
interface ScanState {
    running: boolean;
    serverIds: string[];
}
const scanStates = new Map<string, ScanState>();

interface RobloxServerRaw {
    id: string;
    maxPlayers: number;
    playing: number;
    playerTokens: string[];
    fps: number;
    ping: number;
}

// Probe a single server for its DataCenterId
async function probeDataCenter(
    placeId: string,
    serverId: string,
    cookie: string,
    csrf: string
): Promise<number | null> {
    try {
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
                gameId: serverId,
                gameJoinAttemptId: crypto.randomUUID(),
            }),
            signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (res.status === 403) {
            invalidateCsrf();
            return null;
        }
        if (!res.ok) return null;

        const info = await res.json();
        if (info.joinScript?.DataCenterId) {
            return info.joinScript.DataCenterId;
        }
    } catch { /* timeout or network error */ }
    return null;
}

// ─── Background scan: probes uncached servers gradually ───
async function startBackgroundScan(placeId: string, serverIds: string[]) {
    let state = scanStates.get(placeId);
    if (!state) {
        state = { running: false, serverIds: [] };
        scanStates.set(placeId, state);
    }

    state.serverIds = serverIds;

    // Don't start a second scan if one is already running
    if (state.running) return;
    state.running = true;

    try {
        const cookie = await decryptRobloxCookie();
        if (!cookie) { state.running = false; return; }
        const csrf = await getCsrfToken(cookie);
        if (!csrf) { state.running = false; return; }

        const uncached = serverIds.filter(id => !dcCache.has(id));
        console.log(`[Scan] Background scan for ${placeId}: ${uncached.length} uncached of ${serverIds.length} total`);

        const BATCH_SIZE = 3;
        const BATCH_DELAY = 600;

        for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
            const currentState = scanStates.get(placeId);
            if (!currentState?.running) break;

            const batch = uncached.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (serverId) => {
                if (dcCache.has(serverId)) return;
                const dcId = await probeDataCenter(placeId, serverId, cookie, csrf!);
                if (dcId !== null) {
                    dcCache.set(serverId, dcId);
                }
            }));

            if (i + BATCH_SIZE < uncached.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        }

        console.log(`[Scan] Done for ${placeId}: ${dcCache.size} total cached`);
    } catch (err) {
        console.error("[Scan] Error:", err);
    } finally {
        const s = scanStates.get(placeId);
        if (s) s.running = false;
    }
}

export async function GET(req: NextRequest) {
    const placeId = req.nextUrl.searchParams.get("placeId");
    if (!placeId) {
        return NextResponse.json({ error: "Missing placeId" }, { status: 400 });
    }

    try {
        const cookie = await decryptRobloxCookie();
        if (!cookie) {
            return NextResponse.json({ error: "No Roblox cookie found" }, { status: 401 });
        }
        const csrf = await getCsrfToken(cookie);
        if (!csrf) {
            return NextResponse.json({ error: "Failed to get CSRF token" }, { status: 401 });
        }

        // Fetch all servers from Roblox games API
        const serverMap = new Map<string, RobloxServerRaw>();
        let cursor: string | null = null;

        for (let page = 0; page < 10; page++) {
            const params = new URLSearchParams({
                sortOrder: "Asc",
                excludeFullGames: "true",
                limit: "100",
            });
            if (cursor) params.set("cursor", cursor);

            const gamesRes = await fetch(
                `https://games.roblox.com/v1/games/${placeId}/servers/Public?${params}`,
                {
                    headers: {
                        "Accept": "application/json",
                        "Cookie": `.ROBLOSECURITY=${cookie}`,
                        "x-csrf-token": csrf,
                    },
                }
            );

            if (!gamesRes.ok) break;
            const gamesData = await gamesRes.json();
            for (const srv of (gamesData.data || []) as RobloxServerRaw[]) {
                if (!serverMap.has(srv.id)) {
                    serverMap.set(srv.id, srv);
                }
            }
            cursor = gamesData.nextPageCursor;
            if (!cursor) break;
        }

        const allServers = Array.from(serverMap.values());

        // Start background scan (non-blocking)
        const serverIds = allServers.map(s => s.id);
        startBackgroundScan(placeId, serverIds);

        // Build response with whatever cache has
        const cachedCount = serverIds.filter(id => dcCache.has(id)).length;
        const servers = allServers.map(srv => ({
            id: srv.id,
            playing: srv.playing,
            maxPlayers: srv.maxPlayers,
            fps: srv.fps,
            ping: srv.ping,
            dataCenterId: dcCache.get(srv.id) ?? null,
        }));

        const state = scanStates.get(placeId);

        return NextResponse.json({
            placeId,
            count: allServers.length,
            servers,
            cached: cachedCount,
            scanning: state?.running ?? false,
        });
    } catch (err) {
        console.error("[API/servers] Failed:", err);
        return NextResponse.json({ error: "Failed to fetch servers" }, { status: 502 });
    }
}
