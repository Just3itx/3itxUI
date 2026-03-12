"use client";

import { useRef, useCallback, useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Play, Trash2, FolderOpen, Save, X, Plus, FileCode, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Monaco } from "@monaco-editor/react";
import type * as monacoType from "monaco-editor";
import { ROBLOX_SERVICES, ROBLOX_CLASSES, ROBLOX_GLOBALS, LUAU_STDLIB, type RobloxClass, type GlobalCompletion } from "@/lib/roblox-completions";
import * as lspStore from "@/lib/lsp-store";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
    ssr: false,
    loading: () => (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
            Loading editor...
        </div>
    ),
});

/* ─── Register Luau as a custom language in Monaco ─── */
function registerLuauLanguage(monaco: Monaco) {
    // Only register once
    if (monaco.languages.getLanguages().some((l: { id: string }) => l.id === "luau")) return;

    monaco.languages.register({ id: "luau", extensions: [".luau", ".lua"], aliases: ["Luau", "luau"] });

    // Language configuration (brackets, comments, auto-close)
    monaco.languages.setLanguageConfiguration("luau", {
        comments: { lineComment: "--", blockComment: ["--[[", "]]"] },
        brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
        autoClosingPairs: [
            { open: "{", close: "}" },
            { open: "[", close: "]" },
            { open: "(", close: ")" },
            { open: '"', close: '"', notIn: ["string"] },
            { open: "'", close: "'", notIn: ["string"] },
        ],
        surroundingPairs: [
            { open: "{", close: "}" }, { open: "[", close: "]" },
            { open: "(", close: ")" }, { open: '"', close: '"' }, { open: "'", close: "'" },
        ],
        folding: {
            markers: { start: /^\s*--\s*#?region/, end: /^\s*--\s*#?endregion/ },
        },
        indentationRules: {
            increaseIndentPattern: /^\s*(function|if|else|elseif|for|while|repeat|do|then)\b(?!.*\bend\b)/,
            decreaseIndentPattern: /^\s*(end|else|elseif|until)\b/,
        },
    });

    // Monarch tokenizer for full Luau syntax highlighting
    monaco.languages.setMonarchTokensProvider("luau", {
        defaultToken: "",
        tokenPostfix: ".luau",

        keywords: [
            "and", "break", "continue", "do", "else", "elseif", "end",
            "false", "for", "function", "if", "in", "local", "nil",
            "not", "or", "repeat", "return", "then", "true", "until", "while",
            // Luau-specific
            "type", "export", "typeof",
        ],

        builtinGlobals: [
            // Core Lua/Luau globals
            "game", "workspace", "script", "plugin", "print", "warn", "error",
            "assert", "pcall", "xpcall", "tostring", "tonumber",
            "require", "spawn", "delay", "wait", "tick", "time",
            "pairs", "ipairs", "next", "select", "unpack", "rawget",
            "rawset", "rawequal", "rawlen", "setmetatable", "getmetatable",
            "loadstring", "collectgarbage", "elapsedTime", "typeof",
            "setfenv", "getfenv", "newproxy", "gcinfo",
            // Roblox types / constructors
            "Instance", "Vector3", "Vector2", "CFrame", "Color3",
            "BrickColor", "UDim2", "UDim", "Enum", "Ray", "Region3",
            "TweenInfo", "NumberRange", "NumberSequence", "ColorSequence",
            "Rect", "PhysicalProperties", "OverlapParams", "RaycastParams",
            "Axes", "Faces",
            // Standard libraries
            "Drawing", "math", "string", "table", "bit32", "coroutine",
            "task", "buffer", "debug", "os", "utf8",
            "_G", "_VERSION", "shared",
        ],

        exploitGlobals: [
            "getgenv", "getrenv", "getreg", "getgc", "filtergc", "getinstances", "getnilinstances",
            "getscripts", "getrunningscripts", "getloadedmodules", "getconnections",
            "firesignal", "cfiresignal", "replicatesignal", "fireclickdetector", "fireproximityprompt",
            "firetouchinterest", "fireserver", "hookfunction", "hookmetamethod", "hookproto",
            "newcclosure", "iscclosure", "islclosure", "clonefunction", "getinfo",
            "checkcaller", "checkcallstack", "checkclosure", "isexecutorclosure", "getnamecallmethod",
            "setnamecallmethod", "setreadonly", "isreadonly", "getrawmetatable",
            "setrawmetatable", "gethiddenproperty", "sethiddenproperty",
            "readfile", "readfileasync", "writefile", "writefileasync",
            "appendfile", "appendfileasync", "loadfile", "loadfileasync",
            "listfiles", "isfile", "isfolder",
            "makefolder", "delfolder", "delfile", "setfpscap", "getfpscap",
            "setclipboard", "setfflag", "getfflag",
            "identifyexecutor", "messagebox", "rconsolecreate", "rconsoledestroy",
            "rconsoleinput", "rconsoleprint", "rconsoletitle", "rconsoleinfo", "rconsolewarn", "rconsoleerr",
            "rconsoleclear", "rconsolename",
            "request", "http_request", "syn", "fluxus", "KRNL_LOADED",
            "decompile", "saveinstance", "saveplace", "getthreadidentity", "setthreadidentity",
            "crypt", "base64", "WebSocket",
            // Synapse X V3 additions
            "restorefunction", "restoreproto", "isfunctionhooked", "setstackhidden",
            "hooksignal", "restoresignal", "issignalhooked", "getfilter",
            "getsynasset", "setscriptable", "getproperties", "gethiddenproperties",
            "getpcdprop", "getcallbackmember", "geteventmember", "getrendersteppedlist",
            "issynapsefunction", "getscriptthread", "getsenv", "getscriptfunction",
            "getfunctionhash", "getscriptname", "dumpbytecode", "getcallingscript",
            "issynapsethread", "setsynapsethread",
            "cansignalreplicate", "getsignalarguments",
            "isconnectionenabled", "setconnectionenabled", "isluaconnection",
            "iswaitingconnection", "getconnectionfunction", "getconnectionthread",
            "isgamescriptconnection",
            "unlockmodulescript", "newtable", "cloneref", "compareinstances",
            "setwindowtitle", "setwindowicon", "createuitab", "gethui",
            "setuntouched", "isuntouched", "makewritable", "makereadonly", "isprotected",
            "keypress", "keyrelease", "keyclick", "iskeydown", "iskeytoggled",
            "mouse1click", "mouse1press", "mouse1release",
            "mouse2click", "mouse2press", "mouse2release",
            "mousemoverel", "mousemoveabs", "mousescroll",
            "lockwindow", "unlockwindow", "iswindowlocked", "iswindowactive",
            "getmousestate", "setmousestate",
            "isnetworkowner", "setsimulationradius",
            "queue_on_teleport", "getscriptbytecode", "getscripthash", "getscriptclosure",
            "getupvalue", "setupvalue", "getupvalues",
            "getconstant", "setconstant", "getconstants",
            "getproto", "getprotos", "getstack", "setstack",
            "isrbxactive", "gethwid", "lz4compress", "lz4decompress",
            "getexecutorname", "raknet",
        ],

        operators: [
            "+", "-", "*", "/", "//", "^", "%",
            "<", ">", "<=", ">=", "==", "~=",
            "=", "+=", "-=", "*=", "/=", "//=", "%=", "^=", "..=",
            "..", "#", "::",
        ],

        symbols: /[=><!~?:&|+\-*\/\^%#.]+/,

        escapes: /\\(?:[abfnrtv\\\"']|x[0-9A-Fa-f]{2}|u\{[0-9A-Fa-f]+\}|[0-9]{1,3})/,

        tokenizer: {
            root: [
                // Multiline strings [[ ]] and [=[ ]=]
                [/\[([=]*)\[/, { token: "string.multiline", next: "@multilineString.$1" }],

                // Comments
                [/--\[([=]*)\[/, { token: "comment.multiline", next: "@multilineComment.$1" }],
                [/--.*$/, "comment"],

                // Whitespace
                [/[ \t\r\n]+/, ""],

                // Method calls: :methodName (Lua : is method-call syntax)
                [/(:)([a-zA-Z_]\w*)/, ["delimiter", "function.call"]],

                // Property access: .propertyName
                [/(\.)([a-zA-Z_]\w*)/, ["delimiter", "variable.predefined"]],

                // Keywords & identifiers
                [/[a-zA-Z_]\w*/, {
                    cases: {
                        "@keywords": "keyword",
                        "true": "constant.boolean",
                        "false": "constant.boolean",
                        "nil": "constant.nil",
                        "self": "self",
                        "@exploitGlobals": "variable.exploit",
                        "@builtinGlobals": "predefined",
                        "@default": "identifier",
                    },
                }],

                // Numbers
                [/0[xX][0-9a-fA-F_]+/, "number.hex"],
                [/0[bB][01_]+/, "number.binary"],
                [/\d[\d_]*\.?[\d_]*([eE][\-+]?\d+)?/, "number"],

                // Strings
                [/"/, { token: "string.quote", next: "@doubleString" }],
                [/'/, { token: "string.quote", next: "@singleString" }],

                // Interpolated strings (Luau backtick strings)
                [/`/, { token: "string.quote", next: "@templateString" }],

                // Operators & delimiters
                [/@symbols/, {
                    cases: {
                        "@operators": "operator",
                        "@default": "delimiter",
                    },
                }],

                // Delimiters
                [/[{}()\[\]]/, "@brackets"],
                [/[;,]/, "delimiter"],
            ],

            doubleString: [
                [/[^\\"]+/, "string"],
                [/@escapes/, "string.escape"],
                [/\\./, "string.escape.invalid"],
                [/"/, { token: "string.quote", next: "@pop" }],
            ],

            singleString: [
                [/[^\\']+/, "string"],
                [/@escapes/, "string.escape"],
                [/\\./, "string.escape.invalid"],
                [/'/, { token: "string.quote", next: "@pop" }],
            ],

            templateString: [
                [/\{/, { token: "string.interpolation", next: "@templateExpr" }],
                [/[^\\`{]+/, "string"],
                [/@escapes/, "string.escape"],
                [/`/, { token: "string.quote", next: "@pop" }],
            ],

            templateExpr: [
                [/\}/, { token: "string.interpolation", next: "@pop" }],
                { include: "root" },
            ],

            multilineString: [
                [/[^\]]+/, "string.multiline"],
                [/\]([=]*)\]/, {
                    cases: {
                        "$1==$S2": { token: "string.multiline", next: "@pop" },
                        "@default": "string.multiline",
                    },
                }],
                [/\]/, "string.multiline"],
            ],

            multilineComment: [
                [/[^\]]+/, "comment.multiline"],
                [/\]([=]*)\]/, {
                    cases: {
                        "$1==$S2": { token: "comment.multiline", next: "@pop" },
                        "@default": "comment.multiline",
                    },
                }],
                [/\]/, "comment.multiline"],
            ],
        },
    } as monacoType.languages.IMonarchLanguage);
}

/* Custom theme matching #0a0a0c UI */
function defineCustomTheme(monaco: Monaco) {
    monaco.editor.defineTheme("3itx-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "comment", foreground: "666666", fontStyle: "italic" },
            { token: "comment.multiline", foreground: "666666", fontStyle: "italic" },
            { token: "keyword", foreground: "C792EA" },
            { token: "keyword.control", foreground: "C792EA" },
            { token: "string", foreground: "CE9178" },
            { token: "string.escape", foreground: "84D6F7" },
            { token: "number", foreground: "FFC600" },
            { token: "type", foreground: "4EC9B0" },
            { token: "type.identifier", foreground: "4EC9B0" },
            { token: "function", foreground: "DCDCAA" },
            { token: "function.call", foreground: "DCDCAA" },
            { token: "variable", foreground: "CCCCCC" },
            { token: "variable.predefined", foreground: "9CDCFE" },
            { token: "variable.exploit", foreground: "FF79C6", fontStyle: "bold" },
            { token: "operator", foreground: "CCCCCC" },
            { token: "delimiter", foreground: "CCCCCC" },
            { token: "delimiter.bracket", foreground: "999999" },
            { token: "tag", foreground: "C792EA" },
            { token: "metatag", foreground: "84D6F7" },
            { token: "constant", foreground: "C792EA" },
            { token: "constant.boolean", foreground: "FF5370" },
            { token: "constant.nil", foreground: "FF5370" },
            { token: "predefined", foreground: "82AAFF" },
            { token: "global", foreground: "82AAFF" },
            { token: "self", foreground: "FF5370", fontStyle: "italic" },
        ],
        colors: {
            "editor.background": "#0c0c0e",
            "editor.foreground": "#CCCCCC",
            "editor.lineHighlightBackground": "#ffffff06",
            "editor.selectionBackground": "#264F78",
            "editor.inactiveSelectionBackground": "#264F7840",
            "editorLineNumber.foreground": "#4a4a52",
            "editorLineNumber.activeForeground": "#888888",
            "editorCursor.foreground": "#CCCCCC",
            "editor.selectionHighlightBackground": "#264F7830",
            "editorIndentGuide.background": "#ffffff08",
            "editorIndentGuide.activeBackground": "#ffffff15",
            "editorWidget.background": "#12121a",
            "editorWidget.border": "#ffffff10",
            "editorSuggestWidget.background": "#12121a",
            "editorSuggestWidget.border": "#ffffff10",
            "editorSuggestWidget.foreground": "#CCCCCC",
            "editorSuggestWidget.selectedBackground": "#264F78",
            "editorSuggestWidget.highlightForeground": "#84D6F7",
            "editorSuggestWidget.focusHighlightForeground": "#84D6F7",
            "editorHoverWidget.background": "#12121a",
            "editorHoverWidget.border": "#ffffff10",
            "scrollbar.shadow": "#00000000",
            "scrollbarSlider.background": "#ffffff10",
            "scrollbarSlider.hoverBackground": "#ffffff18",
            "scrollbarSlider.activeBackground": "#ffffff20",
            "list.hoverBackground": "#ffffff08",
            "editorBracketMatch.background": "#ffffff10",
            "editorBracketMatch.border": "#888888",
            "editorBracketHighlight.foreground1": "#FFD700",
            "editorBracketHighlight.foreground2": "#DA70D6",
            "editorBracketHighlight.foreground3": "#87CEEB",
            "editorBracketHighlight.foreground4": "#FF79C6",
            "editorBracketHighlight.foreground5": "#50FA7B",
            "editorBracketHighlight.foreground6": "#F1FA8C",
        },
    });
}

/* â”€â”€â”€ Build class lookup map (includes inheritance) â”€â”€â”€ */
const _classMap = new Map<string, RobloxClass>();
for (const cls of ROBLOX_CLASSES) _classMap.set(cls.name, cls);

/** Resolve all members including inherited ones */
function resolveMembers(className: string): RobloxClass["members"] {
    const seen = new Set<string>();
    const all: RobloxClass["members"] = [];
    let current = _classMap.get(className);
    while (current) {
        for (const m of current.members) {
            if (!seen.has(m.name)) { seen.add(m.name); all.push(m); }
        }
        current = current.parent ? _classMap.get(current.parent) : undefined;
    }
    return all;
}

/** Map common variable names to class names */
const VAR_TO_CLASS: Record<string, string> = {
    workspace: "Workspace", game: "DataModel", script: "LocalScript",
    camera: "Camera", humanoid: "Humanoid", character: "Model",
    player: "Player", mouse: "PlayerMouse", gui: "ScreenGui",
    tween: "Tween", sound: "Sound", part: "BasePart",
    Players: "Players", Lighting: "Lighting", RunService: "RunService",
    UserInputService: "UserInputService", TweenService: "TweenService",
    ReplicatedStorage: "ReplicatedStorage", HttpService: "HttpService",
    MarketplaceService: "MarketplaceService", DataStoreService: "DataStoreService",
    CollectionService: "CollectionService", SoundService: "SoundService",
    PathfindingService: "PathfindingService", Teams: "Teams",
    StarterGui: "StarterGui", StarterPack: "StarterPack",
    ContentProvider: "ContentProvider", ContextActionService: "ContextActionService",
    TextService: "TextService", GuiService: "GuiService",
    Chat: "Chat", BadgeService: "BadgeService",
    Terrain: "Terrain",
};

/* Register Luau completions â€” stores disposables to prevent duplicates on hot reload */
let _completionDisposables: monacoType.IDisposable[] = [];

/** Check if cursor is inside a string, comment, or parentheses â€” suppress completions there */
function isInsideStringOrComment(lineContent: string, col: number): boolean {
    const before = lineContent.substring(0, col - 1);
    // Inside a -- comment
    if (/--/.test(before) && !/--\[\[/.test(before)) return true;
    // Count unescaped quotes to determine if inside a string
    let inSingle = false, inDouble = false;
    for (let i = 0; i < before.length; i++) {
        const ch = before[i];
        if (ch === '\\') { i++; continue; } // skip escaped
        if (ch === '"' && !inSingle) inDouble = !inDouble;
        if (ch === "'" && !inDouble) inSingle = !inSingle;
    }
    if (inSingle || inDouble) return true;
    // Inside parentheses (simple depth check â€” suppress dot-completions inside function calls)
    let depth = 0;
    for (let i = 0; i < before.length; i++) {
        if (before[i] === '(') depth++;
        else if (before[i] === ')') depth--;
    }
    if (depth > 0) return true;
    return false;
}

function registerLuauCompletions(monaco: Monaco) {
    // Dispose any previous registrations to prevent duplicates
    _completionDisposables.forEach(d => d.dispose());
    _completionDisposables = [];

    // â”€â”€ 1. Global completions (non-dot) â”€â”€
    _completionDisposables.push(monaco.languages.registerCompletionItemProvider("luau", {
        triggerCharacters: ["(", ",", " ", "="],
        provideCompletionItems: (model: monacoType.editor.ITextModel, position: monacoType.Position) => {
            const lineContent = model.getLineContent(position.lineNumber);
            if (isInsideStringOrComment(lineContent, position.column)) return { suggestions: [] };

            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            const allCompletions = [...ROBLOX_GLOBALS, ...LUAU_STDLIB];

            // ── Luau keywords with HIGHEST priority so "do" beats "decompile" ──
            const LUAU_KEYWORDS: string[] = [
                "and", "break", "continue", "do", "else", "elseif", "end",
                "false", "for", "function", "if", "in", "local", "nil",
                "not", "or", "repeat", "return", "then", "true", "until", "while",
                "type", "export", "typeof",
            ];

            const getKind = (label: string): monacoType.languages.CompletionItemKind => {
                const types = ["Instance", "Vector3", "Vector2", "CFrame", "Color3", "BrickColor",
                    "UDim2", "UDim", "Enum", "Ray", "Region3", "TweenInfo", "NumberRange",
                    "NumberSequence", "ColorSequence", "Rect", "PhysicalProperties",
                    "OverlapParams", "RaycastParams", "Drawing"];
                if (types.includes(label)) return monaco.languages.CompletionItemKind.Class;
                const modules = ["game", "workspace", "script"];
                if (modules.includes(label)) return monaco.languages.CompletionItemKind.Module;
                const constants = ["math.huge", "math.pi"];
                if (constants.includes(label)) return monaco.languages.CompletionItemKind.Constant;
                if (label.startsWith("string.")) return monaco.languages.CompletionItemKind.Method;
                if (label.startsWith("table.")) return monaco.languages.CompletionItemKind.Method;
                if (label.startsWith("math.")) return monaco.languages.CompletionItemKind.Function;
                if (label.startsWith("bit32.")) return monaco.languages.CompletionItemKind.Operator;
                if (label.startsWith("buffer.")) return monaco.languages.CompletionItemKind.Struct;
                if (label.startsWith("coroutine.") || label.startsWith("task.")) return monaco.languages.CompletionItemKind.Event;
                if (label.startsWith("debug.")) return monaco.languages.CompletionItemKind.Interface;
                if (label.startsWith("os.")) return monaco.languages.CompletionItemKind.Field;
                if (label.includes(".")) return monaco.languages.CompletionItemKind.Method;
                const builtinFns = ["print", "warn", "error", "assert", "type", "typeof", "tostring",
                    "tonumber", "select", "pcall", "xpcall", "ipairs", "pairs", "next",
                    "unpack", "rawget", "rawset", "rawequal", "rawlen", "setmetatable",
                    "getmetatable", "require", "spawn", "delay", "wait", "tick", "time",
                    "elapsedTime", "collectgarbage", "loadstring"];
                if (builtinFns.includes(label)) return monaco.languages.CompletionItemKind.Keyword;
                return monaco.languages.CompletionItemKind.Function;
            };

            // Keywords get sortText "!0_" (highest), globals "0_", stdlib "1_"
            const suggestions: monacoType.languages.CompletionItem[] = LUAU_KEYWORDS.map((kw, i) => ({
                label: kw,
                kind: monaco.languages.CompletionItemKind.Keyword,
                detail: "keyword",
                insertText: kw,
                range,
                sortText: `!0_${String(i).padStart(3, "0")}`,
            }));

            suggestions.push(...allCompletions.map((g, i) => ({
                label: g.label,
                kind: getKind(g.label),
                detail: g.detail,
                documentation: g.doc,
                insertText: g.label,
                range,
                sortText: `${i < ROBLOX_GLOBALS.length ? "0" : "1"}_${g.label}`,
            })));

            return { suggestions };
        },
    }));

    // â”€â”€ 2. Dot-completion for Roblox classes (triggers on . and :) â”€â”€
    _completionDisposables.push(monaco.languages.registerCompletionItemProvider("luau", {
        triggerCharacters: [".", ":"],
        provideCompletionItems: (model: monacoType.editor.ITextModel, position: monacoType.Position) => {
            const lineContent = model.getLineContent(position.lineNumber);
            const textBefore = lineContent.substring(0, position.column - 1);

            // Don't trigger inside comments or strings
            if (/--/.test(textBefore) && !/--\[\[/.test(textBefore)) return { suggestions: [] };
            {
                let _s = false, _d = false;
                for (let i = 0; i < textBefore.length; i++) {
                    if (textBefore[i] === '\\') { i++; continue; }
                    if (textBefore[i] === '"' && !_s) _d = !_d;
                    if (textBefore[i] === "'" && !_d) _s = !_s;
                }
                if (_s || _d) return { suggestions: [] };
            }

            // Handle: game:GetService("Players"). | workspace.Part. | Players.
            const getServiceMatch = textBefore.match(/(\w+):GetService\(\s*["'](\w+)["']\s*\)\s*([.:])$/);
            const simpleMatch = textBefore.match(/([\w.]+)\s*([.:])\s*$/);

            let resolvedClass = "";
            let resolvedPath: string[] = [];
            let accessor = ".";

            if (getServiceMatch) {
                const serviceName = getServiceMatch[2];
                accessor = getServiceMatch[3];
                resolvedClass = serviceName;
                resolvedPath = ["game", serviceName];
            } else if (simpleMatch) {
                const fullPath = simpleMatch[1];
                accessor = simpleMatch[2];
                resolvedPath = fullPath.split(".");
                const varName = resolvedPath[resolvedPath.length - 1];
                resolvedClass = VAR_TO_CLASS[varName] || varName;
            } else {
                return { suggestions: [] };
            }

            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            const suggestions: monacoType.languages.CompletionItem[] = [];
            let sortOffset = 0;

            // -- Static class completions --
            if (_classMap.has(resolvedClass) || ROBLOX_SERVICES.includes(resolvedClass)) {
                const members = resolveMembers(resolvedClass);
                const filtered = accessor === ":"
                    ? members.filter(m => m.kind === "method")
                    : members.filter(m => m.kind === "property" || m.kind === "event");

                suggestions.push(...filtered.map((m, i) => {
                    let kind: monacoType.languages.CompletionItemKind;
                    if (m.kind === "method") kind = monaco.languages.CompletionItemKind.Method;
                    else if (m.kind === "event") kind = monaco.languages.CompletionItemKind.Event;
                    else kind = monaco.languages.CompletionItemKind.Property;

                    return {
                        label: m.name,
                        kind,
                        detail: m.detail,
                        insertText: m.name,
                        range,
                        sortText: String(i).padStart(4, "0"),
                    };
                }));
                sortOffset = suggestions.length;
            }

            // -- LSP Connect: live game tree completions --
            if (accessor === "." && lspStore.hasData() && resolvedPath.length > 0) {
                const lspChildren = lspStore.getChildrenAtPath(resolvedPath);
                const existingNames = new Set(suggestions.map(s => typeof s.label === 'string' ? s.label : ''));
                lspChildren.forEach((child: lspStore.LspNode, i: number) => {
                    if (!existingNames.has(child.name)) {
                        suggestions.push({
                            label: child.name,
                            kind: monaco.languages.CompletionItemKind.Module,
                            detail: child.className,
                            insertText: child.name,
                            range,
                            sortText: String(sortOffset + i).padStart(4, "0"),
                        });
                    }
                });
            }

            return { suggestions };
        },
    }));

    // â”€â”€ 3. GetService string completions â”€â”€
    _completionDisposables.push(monaco.languages.registerCompletionItemProvider("luau", {
        triggerCharacters: ['"', "'"],
        provideCompletionItems: (model: monacoType.editor.ITextModel, position: monacoType.Position) => {
            const lineContent = model.getLineContent(position.lineNumber);
            const textBefore = lineContent.substring(0, position.column - 1);

            // Match GetService(" or GetService('
            if (!textBefore.match(/GetService\s*\(\s*["']$/)) return { suggestions: [] };

            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            return {
                suggestions: ROBLOX_SERVICES.map((svc, i) => ({
                    label: svc,
                    kind: monaco.languages.CompletionItemKind.Module,
                    detail: "Roblox Service",
                    insertText: svc,
                    range,
                    sortText: String(i).padStart(3, "0"),
                })),
            };
        },
    }));
}

/* ─── Luau Diagnostics Provider ─── */
const LUAU_KEYWORDS = new Set([
    "and", "break", "continue", "do", "else", "elseif", "end",
    "false", "for", "function", "if", "in", "local", "nil",
    "not", "or", "repeat", "return", "then", "true", "until", "while",
    "type", "export", "typeof", "self",
]);

const KNOWN_GLOBALS = new Set([
    // Core Lua/Luau globals
    "print", "warn", "error", "assert", "pcall", "xpcall", "tostring", "tonumber",
    "require", "spawn", "delay", "wait", "tick", "time", "type", "typeof",
    "pairs", "ipairs", "next", "select", "unpack", "rawget", "rawset", "rawequal", "rawlen",
    "setmetatable", "getmetatable", "loadstring", "collectgarbage", "elapsedTime",
    "setfenv", "getfenv", "newproxy", "gcinfo",
    // Roblox globals
    "game", "workspace", "script", "plugin",
    // Roblox types
    "Instance", "Vector3", "Vector2", "CFrame", "Color3", "BrickColor",
    "UDim2", "UDim", "Enum", "Ray", "Region3", "TweenInfo", "NumberRange",
    "NumberSequence", "ColorSequence", "Rect", "PhysicalProperties",
    "OverlapParams", "RaycastParams", "Drawing", "Axes", "Faces",
    // Libraries
    "math", "string", "table", "bit32", "coroutine", "task", "buffer",
    "debug", "os", "utf8",
    // Executor globals
    "getgenv", "getrenv", "getreg", "getgc", "filtergc", "getinstances", "getnilinstances",
    "getscripts", "getrunningscripts", "getloadedmodules", "getconnections",
    "firesignal", "cfiresignal", "replicatesignal", "fireclickdetector", "fireproximityprompt",
    "firetouchinterest", "fireserver", "hookfunction", "hookmetamethod", "hookproto",
    "newcclosure", "iscclosure", "islclosure", "clonefunction", "getinfo",
    "checkcaller", "checkcallstack", "checkclosure", "isexecutorclosure", "getnamecallmethod",
    "setnamecallmethod", "setreadonly", "isreadonly", "getrawmetatable",
    "setrawmetatable", "gethiddenproperty", "sethiddenproperty",
    "readfile", "readfileasync", "writefile", "writefileasync",
    "appendfile", "appendfileasync", "loadfile", "loadfileasync",
    "listfiles", "isfile", "isfolder",
    "makefolder", "delfolder", "delfile",
    "setclipboard", "setfflag", "getfflag", "setfpscap", "getfpscap",
    "identifyexecutor", "messagebox", "rconsolecreate", "rconsoledestroy",
    "rconsoleinput", "rconsoleprint", "rconsoletitle", "rconsoleinfo", "rconsolewarn", "rconsoleerr",
    "rconsoleclear", "rconsolename",
    "request", "http_request", "syn", "fluxus", "KRNL_LOADED",
    "decompile", "saveinstance", "saveplace", "getthreadidentity", "setthreadidentity",
    "crypt", "base64", "Drawing", "WebSocket",
    // Synapse X V3 additions
    "restorefunction", "restoreproto", "isfunctionhooked", "setstackhidden",
    "hooksignal", "restoresignal", "issignalhooked", "getfilter",
    "getsynasset", "setscriptable", "getproperties", "gethiddenproperties",
    "getpcdprop", "getcallbackmember", "geteventmember", "getrendersteppedlist",
    "issynapsefunction", "getscriptthread", "getsenv", "getscriptfunction",
    "getfunctionhash", "getscriptname", "dumpbytecode", "getcallingscript",
    "issynapsethread", "setsynapsethread",
    "cansignalreplicate", "getsignalarguments",
    "isconnectionenabled", "setconnectionenabled", "isluaconnection",
    "iswaitingconnection", "getconnectionfunction", "getconnectionthread",
    "isgamescriptconnection",
    "unlockmodulescript", "newtable", "cloneref", "compareinstances",
    "setwindowtitle", "setwindowicon", "createuitab", "gethui",
    "setuntouched", "isuntouched", "makewritable", "makereadonly", "isprotected",
    "keypress", "keyrelease", "keyclick", "iskeydown", "iskeytoggled",
    "mouse1click", "mouse1press", "mouse1release",
    "mouse2click", "mouse2press", "mouse2release",
    "mousemoverel", "mousemoveabs", "mousescroll",
    "lockwindow", "unlockwindow", "iswindowlocked", "iswindowactive",
    "getmousestate", "setmousestate",
    "isnetworkowner", "setsimulationradius",
    "queue_on_teleport", "getscriptbytecode", "getscripthash", "getscriptclosure",
    "getupvalue", "setupvalue", "getupvalues",
    "getconstant", "setconstant", "getconstants",
    "getproto", "getprotos", "getstack", "setstack",
    "isrbxactive", "gethwid", "lz4compress", "lz4decompress",
    "getexecutorname", "raknet",
    "_G", "_VERSION", "shared",
]);

/** Call luau-lsp analyze via the API route and set Monaco markers */
let _analyzeAbort: AbortController | null = null;

async function validateLuau(
    model: monacoType.editor.ITextModel,
    monaco: Monaco
) {
    const code = model.getValue();
    if (!code.trim()) {
        monaco.editor.setModelMarkers(model, "luau-diagnostics", []);
        return;
    }

    // Cancel previous in-flight request
    if (_analyzeAbort) _analyzeAbort.abort();
    _analyzeAbort = new AbortController();

    try {
        const res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
            signal: _analyzeAbort.signal,
        });
        if (!res.ok) {
            monaco.editor.setModelMarkers(model, "luau-diagnostics", []);
            return;
        }
        const data = await res.json();
        const diagnostics = data.diagnostics || [];

        const markers: monacoType.editor.IMarkerData[] = diagnostics.map(
            (d: { line: number; col: number; endLine: number; endCol: number; severity: string; message: string }) => {
                let severity = monaco.MarkerSeverity.Error;
                const sev = d.severity.toLowerCase();
                if (sev.includes("warning") || sev.startsWith("lint")) {
                    severity = monaco.MarkerSeverity.Warning;
                } else if (sev.includes("info") || sev.includes("hint")) {
                    severity = monaco.MarkerSeverity.Info;
                }

                return {
                    startLineNumber: d.line,
                    startColumn: d.col,
                    endLineNumber: d.endLine,
                    endColumn: d.endCol,
                    message: d.message,
                    severity,
                    source: "luau-lsp",
                };
            }
        );

        monaco.editor.setModelMarkers(model, "luau-diagnostics", markers);
    } catch (e: any) {
        if (e?.name === "AbortError") return; // cancelled — ignore
        // On error, just clear markers
        monaco.editor.setModelMarkers(model, "luau-diagnostics", []);
    }
}

let _diagTimer: ReturnType<typeof setTimeout> | null = null;

function registerLuauDiagnostics(editor: monacoType.editor.IStandaloneCodeEditor, monaco: Monaco) {
    const runDiag = () => {
        if (_diagTimer) clearTimeout(_diagTimer);
        _diagTimer = setTimeout(() => {
            const model = editor.getModel();
            if (model) validateLuau(model, monaco);
        }, 100); // 100ms debounce for analyze calls
    };

    editor.onDidChangeModelContent(runDiag);
    // Run once on mount
    runDiag();
}

export interface EditorTab {
    id: number;
    name: string;
    content: string;
}

interface EditorPanelProps {
    tabs: EditorTab[];
    activeTabId: number;
    onSwitchTab: (id: number) => void;
    onCloseTab: (id: number) => void;
    onAddTab: () => void;
    onRenameTab?: (id: number, newName: string) => void;
    onContentChange: (id: number, content: string) => void;
    onExecute: () => void;
    onClear: () => void;
    onOpen: () => void;
    onSave: () => void;
    onLaunch: () => void;
    fontSize: number;
    wordWrap?: boolean;
    lineNumbers?: boolean;
    bracketPairColorization?: boolean;
}

export default function EditorPanel({
    tabs,
    activeTabId,
    onSwitchTab,
    onCloseTab,
    onAddTab,
    onRenameTab,
    onContentChange,
    onExecute,
    onClear,
    onOpen,
    onSave,
    onLaunch,
    fontSize,
    wordWrap = false,
    lineNumbers = true,
    bracketPairColorization = true,
}: EditorPanelProps) {
    const [editingTabId, setEditingTabId] = useState<number | null>(null);
    const [editingName, setEditingName] = useState("");
    const renameInputRef = useRef<HTMLInputElement>(null);
    // Track saved content per tab for the unsaved dot indicator
    const savedContentRef = useRef<Record<number, string>>({});

    const activeTab = useMemo(
        () => tabs.find((t) => t.id === activeTabId),
        [tabs, activeTabId]
    );

    // Initialize saved content for new tabs
    useEffect(() => {
        tabs.forEach((t) => {
            if (!(t.id in savedContentRef.current)) {
                savedContentRef.current[t.id] = t.content;
            }
        });
    }, [tabs]);

    // Ctrl+S save shortcut + block dev tools
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Ctrl+S â†’ save
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                onSave();
                // Mark current tab as saved
                const tab = tabs.find((t) => t.id === activeTabId);
                if (tab) savedContentRef.current[tab.id] = tab.content;
            }
            // Block dev tools shortcuts
            if (e.key === "F12") e.preventDefault();
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "I" || e.key === "i" || e.key === "J" || e.key === "j")) e.preventDefault();
            if ((e.ctrlKey || e.metaKey) && (e.key === "U" || e.key === "u")) e.preventDefault();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onSave, tabs, activeTabId]);

    const isTabUnsaved = useCallback((tab: EditorTab) => {
        return savedContentRef.current[tab.id] !== undefined && savedContentRef.current[tab.id] !== tab.content;
    }, []);
    const startRename = useCallback((tabId: number, currentName: string) => {
        setEditingTabId(tabId);
        setEditingName(currentName);
        setTimeout(() => renameInputRef.current?.select(), 0);
    }, []);

    const commitRename = useCallback(() => {
        if (editingTabId !== null && editingName.trim()) {
            onRenameTab?.(editingTabId, editingName.trim());
        }
        setEditingTabId(null);
    }, [editingTabId, editingName, onRenameTab]);

    const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
    const contentChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeTabIdRef = useRef(activeTabId);
    activeTabIdRef.current = activeTabId;

    const handleEditorMount = useCallback((editor: monacoType.editor.IStandaloneCodeEditor, monaco: Monaco) => {
        editorRef.current = editor;
        registerLuauLanguage(monaco);
        defineCustomTheme(monaco);
        monaco.editor.setTheme("3itx-dark");
        registerLuauCompletions(monaco);
        registerLuauDiagnostics(editor, monaco);

        // Use onDidChangeModelContent instead of controlled value prop
        editor.onDidChangeModelContent(() => {
            const value = editor.getValue();
            // Debounce the state update to avoid excessive re-renders during fast typing
            if (contentChangeTimerRef.current) clearTimeout(contentChangeTimerRef.current);
            contentChangeTimerRef.current = setTimeout(() => {
                onContentChange(activeTabIdRef.current, value);
            }, 50); // 50ms debounce — fast enough for UI, avoids storm
        });
    }, [onContentChange]);

    // When activeTab changes, update editor content without going through React re-render
    const prevTabIdRef = useRef(activeTabId);
    useEffect(() => {
        if (editorRef.current && activeTabId !== prevTabIdRef.current) {
            const model = editorRef.current.getModel();
            if (model && activeTab) {
                // Save and restore view state per tab could be added here
                model.setValue(activeTab.content);
            }
            prevTabIdRef.current = activeTabId;
        }
    }, [activeTabId, activeTab]);

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            {/* Tab strip */}
            <div className="flex items-end h-[36px] bg-[#0c0c0e] border-b border-white/[0.06] px-2 gap-0.5 shrink-0 overflow-x-auto">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => onSwitchTab(tab.id)}
                        onDoubleClick={(e) => {
                            e.preventDefault();
                            startRename(tab.id, tab.name);
                        }}
                        className={cn(
                            "group flex items-center gap-1.5 h-[30px] px-3 text-[11px] rounded-t-lg transition-all duration-200 whitespace-nowrap",
                            tab.id === activeTabId
                                ? "bg-[#0c0c0e] text-foreground border border-white/[0.06] border-b-transparent"
                                : "text-muted-foreground hover:text-foreground/70 hover:bg-white/[0.04]"
                        )}
                    >
                        <FileCode className="w-3 h-3 shrink-0 text-blue-400/50" />
                        {editingTabId === tab.id ? (
                            <input
                                ref={renameInputRef}
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") commitRename();
                                    if (e.key === "Escape") setEditingTabId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-[80px] bg-white/10 border border-white/20 rounded px-1 text-[11px] text-foreground outline-none"
                                autoFocus
                            />
                        ) : (
                            <span>{tab.name}</span>
                        )}
                        <span
                            onClick={(e) => {
                                e.stopPropagation();
                                onCloseTab(tab.id);
                            }}
                            className={cn(
                                "flex items-center justify-center w-4 h-4 rounded transition-all",
                                tab.id === activeTabId || "opacity-0 group-hover:opacity-100",
                                "hover:bg-white/10 hover:text-destructive"
                            )}
                        >
                            {isTabUnsaved(tab) ? (
                                <span className="w-2 h-2 rounded-full bg-white group-hover:hidden" />
                            ) : null}
                            <X className={cn("w-2.5 h-2.5", isTabUnsaved(tab) && "hidden group-hover:block")} />
                        </span>
                    </button>
                ))}
                <button
                    onClick={onAddTab}
                    className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-white/[0.04] rounded-lg transition-all shrink-0 ml-0.5"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Monaco Editor — uncontrolled value to prevent cursor displacement during fast typing */}
            <div className="flex-1 overflow-hidden bg-[#0c0c0e]">
                <MonacoEditor
                    language="luau"
                    theme="3itx-dark"
                    defaultValue={activeTab?.content || ""}
                    onMount={handleEditorMount}
                    options={{
                        fontSize: fontSize,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontLigatures: true,
                        minimap: { enabled: true, renderCharacters: false, scale: 1, side: "right" },
                        scrollBeyondLastLine: false,
                        lineNumbers: lineNumbers ? "on" : "off",
                        lineNumbersMinChars: 3,
                        glyphMargin: false,
                        folding: true,
                        renderLineHighlight: "line",
                        renderLineHighlightOnlyWhenFocus: true,
                        overviewRulerLanes: 0,
                        hideCursorInOverviewRuler: true,
                        overviewRulerBorder: false,
                        scrollbar: {
                            verticalScrollbarSize: 6,
                            horizontalScrollbarSize: 6,
                            useShadows: false,
                        },
                        padding: { top: 12, bottom: 12 },
                        smoothScrolling: true,
                        cursorSmoothCaretAnimation: "on",
                        cursorBlinking: "smooth",
                        tabSize: 2,
                        wordWrap: wordWrap ? "on" : "off",
                        automaticLayout: true,
                        contextmenu: true,
                        suggestOnTriggerCharacters: true,
                        quickSuggestions: true,
                        ...({ "bracketPairColorization.enabled": bracketPairColorization } as any),
                        guides: {
                            bracketPairs: bracketPairColorization,
                            bracketPairsHorizontal: bracketPairColorization,
                        },
                        suggest: {
                            showIcons: true,
                            showStatusBar: true,
                            preview: true,
                        },
                    }}
                />
            </div>

            {/* Bottom toolbar */}
            <div className="flex items-center h-[38px] bg-[#0c0c0e] border-t border-white/[0.06] px-3 gap-1.5 shrink-0">
                <Button size="sm" onClick={onExecute} className="gap-1.5 h-[28px] text-[11px] font-semibold bg-white text-black hover:bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.1)] transition-all duration-200 hover:shadow-[0_0_12px_rgba(255,255,255,0.2)]">
                    <Play className="w-3 h-3" />
                    Execute
                </Button>
                <Button size="sm" variant="outline" onClick={onClear} className="gap-1.5 h-[28px] text-[11px] bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-all duration-200">
                    <Trash2 className="w-3 h-3" />
                    Clear
                </Button>
                <Button size="sm" variant="outline" onClick={onOpen} className="gap-1.5 h-[28px] text-[11px] bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-all duration-200">
                    <FolderOpen className="w-3 h-3" />
                    Open
                </Button>
                <Button size="sm" variant="outline" onClick={onSave} className="gap-1.5 h-[28px] text-[11px] bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-all duration-200">
                    <Save className="w-3 h-3" />
                    Save
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="outline" onClick={onLaunch} className="gap-1.5 h-[28px] text-[11px] bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-all duration-200">
                    <Rocket className="w-3 h-3" />
                    Launch
                </Button>
            </div>
        </div>
    );
}
