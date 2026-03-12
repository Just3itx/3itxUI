import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Luau LSP Analyze API — runs luau-lsp analyze on editor code
 * and returns diagnostics for Monaco to display as markers.
 */

function getDataPath() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "3itx_UI");
}

function getLspExePath() {
    return path.join(getDataPath(), "luau-lsp", "luau-lsp.exe");
}

function getDefinitionsPath() {
    return path.join(getDataPath(), "definitions", "executor-globals.d.luau");
}

function getGlobalTypesPath() {
    const projectRoot = path.resolve(process.cwd());
    return path.join(projectRoot, "globalTypes.d.lua");
}

interface DiagnosticResult {
    line: number;
    col: number;
    endLine: number;
    endCol: number;
    severity: string;
    message: string;
    code: string;
}

function parseDiagnostics(output: string): DiagnosticResult[] {
    const results: DiagnosticResult[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith("[INFO]") || line.startsWith("[WARN]")) continue;
        if (!line.includes("): ")) continue;

        // Match: path/file.luau(line,col): Category: message
        // Or:    path/file.luau(line,col-endline,endcol): Category: message
        const match = line.match(
            /\((\d+),(\d+)(?:-(\d+),(\d+))?\):\s*(\w+):\s*(.+)$/
        );
        if (match) {
            const startLine = parseInt(match[1], 10);
            const startCol = parseInt(match[2], 10);
            const endLine = match[3] ? parseInt(match[3], 10) : startLine;
            const endCol = match[4] ? parseInt(match[4], 10) : startCol + 1;
            const severity = match[5];
            const message = match[6].trim();

            results.push({
                line: startLine,
                col: startCol,
                endLine,
                endCol,
                severity,
                message,
                code: severity,
            });
        }
    }

    return results;
}

export async function POST(req: NextRequest) {
    try {
        const { code } = await req.json();
        if (typeof code !== "string") {
            return NextResponse.json({ diagnostics: [] });
        }

        const lspExe = getLspExePath();
        if (!fs.existsSync(lspExe)) {
            return NextResponse.json({ diagnostics: [], error: "luau-lsp not installed" });
        }

        // Write code to a temp file
        const dataPath = getDataPath();
        const tempDir = path.join(dataPath, "temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempFile = path.join(tempDir, "analyze_temp.luau");
        fs.writeFileSync(tempFile, code, "utf-8");

        // Build args
        const args: string[] = ["analyze", "--no-strict-dm-types"];

        const globalTypes = getGlobalTypesPath();
        if (fs.existsSync(globalTypes)) {
            args.push(`--definitions=@roblox=${globalTypes}`);
        }

        const execDefs = getDefinitionsPath();
        if (fs.existsSync(execDefs)) {
            args.push(`--definitions=@executor=${execDefs}`);
        }

        const luaurc = path.join(dataPath, ".luaurc");
        if (fs.existsSync(luaurc)) {
            args.push(`--base-luaurc=${luaurc}`);
        }

        args.push(tempFile);

        // Use spawn instead of execFile to reliably capture all output
        const diagnostics = await new Promise<DiagnosticResult[]>((resolve) => {
            const proc = spawn(lspExe, args, { timeout: 10000 });
            let allOutput = "";

            proc.stdout.on("data", (data) => { allOutput += data.toString(); });
            proc.stderr.on("data", (data) => { allOutput += data.toString(); });

            proc.on("close", () => {
                resolve(parseDiagnostics(allOutput));
            });

            proc.on("error", () => {
                resolve([]);
            });
        });

        // Cleanup temp file
        try { fs.unlinkSync(tempFile); } catch { /* ignore */ }

        return NextResponse.json({ diagnostics });
    } catch (e) {
        return NextResponse.json({ diagnostics: [], error: String(e) }, { status: 500 });
    }
}
