import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy for external script hub APIs (ScriptBlox & RScripts)
 * to avoid CORS issues in the browser.
 *
 * Usage:
 *   /api/scripts?provider=scriptblox&page=1&q=search
 *   /api/scripts?provider=rscripts&page=1&q=search&orderBy=date&sort=desc
 */

const SCRIPTBLOX_BASE = "https://scriptblox.com/api/script";
const RSCRIPTS_BASE = "https://rscripts.net/api/v2/scripts";

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || "scriptblox";
    const page = searchParams.get("page") || "1";
    const query = searchParams.get("q") || "";
    const orderBy = searchParams.get("orderBy") || "";
    const sort = searchParams.get("sort") || "";

    try {
        let url: string;

        if (provider === "rscripts") {
            const params = new URLSearchParams({ page });
            if (query) params.set("q", query);
            if (orderBy) params.set("orderBy", orderBy);
            if (sort) params.set("sort", sort);
            url = `${RSCRIPTS_BASE}?${params.toString()}`;
        } else {
            // ScriptBlox
            if (query) {
                url = `${SCRIPTBLOX_BASE}/search?q=${encodeURIComponent(query)}&page=${page}&max=20`;
            } else {
                url = `${SCRIPTBLOX_BASE}/fetch?page=${page}&max=20`;
            }
        }

        const res = await fetch(url, {
            headers: { "User-Agent": "3itx-UI/1.0" },
            next: { revalidate: 30 },
        });

        if (!res.ok) {
            return NextResponse.json(
                { error: `Upstream returned ${res.status}` },
                { status: res.status }
            );
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json(
            { error: err.message || "Failed to fetch scripts" },
            { status: 500 }
        );
    }
}
