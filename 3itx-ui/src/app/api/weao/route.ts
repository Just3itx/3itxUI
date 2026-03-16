import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Proxy for the WEAO status API (requires specific User-Agent header) */
export async function GET() {
    try {
        const res = await fetch("https://weao.xyz/api/status/exploits/WEAO228206d0", {
            headers: { "User-Agent": "WEAO-3PService" },
            next: { revalidate: 60 }, // cache for 60s
        });
        if (!res.ok) return NextResponse.json({ error: "WEAO API error" }, { status: res.status });
        const data = await res.json();
        return NextResponse.json(data);
    } catch {
        return NextResponse.json({ error: "Failed to reach WEAO" }, { status: 500 });
    }
}
