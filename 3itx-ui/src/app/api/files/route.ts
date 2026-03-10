import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * File operations API — used as a fallback when the WebView2 bridge is unavailable (dev mode).
 * In production (inside the C# launcher), the WebView2 bridge handles all file ops directly.
 */

function getBaseDir() {
    // In dev mode, use the project directory or CWD
    const base = process.cwd();
    return base;
}

function getRoot(root: string): string {
    // Use %LOCALAPPDATA%\3itx_UI for persistent storage (matches C# launcher)
    const localAppData = process.env.LOCALAPPDATA || process.env.HOME || "";
    const base = path.join(localAppData, "3itx_UI");
    if (root === "scripts") return path.join(base, "Scripts");
    if (root === "autoexec") return path.join(base, "AutoExec");
    throw new Error("Invalid root");
}

function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface FileNode {
    id: string;
    name: string;
    type: "file" | "folder";
    children?: FileNode[];
}

let _nodeId = 1000;
function buildTree(dir: string): FileNode[] {
    ensureDir(dir);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.map((e) => {
        const id = `api_node_${_nodeId++}`;
        if (e.isDirectory()) {
            return {
                id,
                name: e.name,
                type: "folder" as const,
                children: buildTree(path.join(dir, e.name)),
                expanded: false,
            };
        }
        return { id, name: e.name, type: "file" as const };
    });
}

function safePath(root: string, filePath: string): string {
    const base = getRoot(root);
    const resolved = path.resolve(base, filePath);
    if (!resolved.startsWith(base)) throw new Error("Path traversal blocked");
    return resolved;
}

export async function GET(req: NextRequest) {
    const root = req.nextUrl.searchParams.get("root") || "scripts";
    try {
        const dir = getRoot(root);
        ensureDir(dir);
        const tree = buildTree(dir);
        return NextResponse.json({ tree });
    } catch (e) {
        return NextResponse.json({ error: String(e) }, { status: 400 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, root, filePath, content, newName } = body;

        switch (action) {
            case "read": {
                const p = safePath(root, filePath);
                if (!fs.existsSync(p)) return NextResponse.json({ content: "" });
                const data = fs.readFileSync(p, "utf-8");
                return NextResponse.json({ content: data });
            }
            case "write": {
                const p = safePath(root, filePath);
                ensureDir(path.dirname(p));
                fs.writeFileSync(p, content ?? "", "utf-8");
                return NextResponse.json({ ok: true });
            }
            case "createFile": {
                const p = safePath(root, filePath);
                if (!fs.existsSync(p)) {
                    ensureDir(path.dirname(p));
                    fs.writeFileSync(p, "", "utf-8");
                }
                return NextResponse.json({ ok: true });
            }
            case "createFolder": {
                const p = safePath(root, filePath);
                ensureDir(p);
                return NextResponse.json({ ok: true });
            }
            case "delete": {
                const p = safePath(root, filePath);
                if (fs.existsSync(p)) {
                    const stat = fs.statSync(p);
                    if (stat.isDirectory()) fs.rmSync(p, { recursive: true });
                    else fs.unlinkSync(p);
                }
                return NextResponse.json({ ok: true });
            }
            case "rename": {
                const p = safePath(root, filePath);
                const newPath = safePath(root, newName);
                if (fs.existsSync(p)) fs.renameSync(p, newPath);
                return NextResponse.json({ ok: true });
            }
            default:
                return NextResponse.json({ error: "Unknown action" }, { status: 400 });
        }
    } catch (e) {
        return NextResponse.json({ error: String(e) }, { status: 400 });
    }
}
