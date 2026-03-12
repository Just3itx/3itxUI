import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
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
    // globalTypes.d.lua is in the 3itx-ui project root
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
        // Skip non-diagnostic lines (info messages, blank lines)
        if (!line.trim()) continue;
        if (line.startsWith("[INFO]") || line.startsWith("[WARN]")) continue;
        if (!line.includes("): ")) continue;

        // Match patterns like:
        // path/file.luau(2,1): TypeError: message
        // path/file.luau(2,1-2,14): TypeError: message
        // path/file.luau(1,7): LocalUnused: Variable 'x' is never used...
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

        // Add globalTypes definitions (Roblox API types)
        const globalTypes = getGlobalTypesPath();
        if (fs.existsSync(globalTypes)) {
            args.push(`--definitions=@roblox=${globalTypes}`);
        }

        // Add executor definitions (UNC functions)
        const execDefs = getDefinitionsPath();
        if (fs.existsSync(execDefs)) {
            args.push(`--definitions=@executor=${execDefs}`);
        }

        // Add .luaurc base config if it exists
        const luaurc = path.join(dataPath, ".luaurc");
        if (fs.existsSync(luaurc)) {
            args.push(`--base-luaurc=${luaurc}`);
        }

        args.push(tempFile);

        // Run luau-lsp analyze
        const diagnostics = await new Promise<DiagnosticResult[]>((resolve) => {
            execFile(lspExe, args, { timeout: 10000, maxBuffer: 1024 * 512 }, (error, stdout, stderr) => {
                // luau-lsp analyze returns exit code 1 when it finds errors
                // Diagnostics go to stderr, so we need to capture ALL output
                let allOutput = "";
                if (stderr) allOutput += stderr;
                if (stdout) allOutput += stdout;
                // When execFile reports an error with code 1, stderr might be in error.stderr
                if (error && (error as any).stderr) {
                    allOutput += (error as any).stderr;
                }
                // Also check error.stdout
                if (error && (error as any).stdout) {
                    allOutput += (error as any).stdout;
                }

                resolve(parseDiagnostics(allOutput));
            });
        });

        // Cleanup temp file
        try { fs.unlinkSync(tempFile); } catch { /* ignore */ }

        return NextResponse.json({ diagnostics });
    } catch (e) {
        return NextResponse.json({ diagnostics: [], error: String(e) }, { status: 500 });
    }
}
