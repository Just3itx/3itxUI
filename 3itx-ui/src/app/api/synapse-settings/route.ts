import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const SETTINGS_PATH = path.join(
    process.env.LOCALAPPDATA || "",
    "Synapse Z",
    "bin",
    "settings.syn"
);

export async function GET() {
    try {
        if (!existsSync(SETTINGS_PATH)) {
            return NextResponse.json({ error: "settings.syn not found" }, { status: 404 });
        }
        const raw = await readFile(SETTINGS_PATH, "utf-8");
        const settings = JSON.parse(raw);
        return NextResponse.json(settings);
    } catch (e: unknown) {
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "Failed to read settings" },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        // Read existing settings, merge with updates
        let existing: Record<string, unknown> = {};
        if (existsSync(SETTINGS_PATH)) {
            const raw = await readFile(SETTINGS_PATH, "utf-8");
            existing = JSON.parse(raw);
        }
        const merged = { ...existing, ...body };
        await writeFile(SETTINGS_PATH, JSON.stringify(merged), "utf-8");
        return NextResponse.json({ ok: true });
    } catch (e: unknown) {
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "Failed to write settings" },
            { status: 500 }
        );
    }
}
