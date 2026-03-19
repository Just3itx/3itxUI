"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
    Search, ChevronRight, ChevronDown, X, Copy, Eye, EyeOff,
    Loader2, FolderTree, FileCode, RotateCcw, Activity, WifiOff, Camera, Crosshair
} from "lucide-react";
import { cn } from "@/lib/utils";
import * as fsBridge from "@/lib/fs-bridge";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @next/next/no-img-element */

/* ─── Types ─── */

interface TreeNode {
    name: string;
    className: string;
    path: string;
    hasChildren: boolean;
    children?: TreeNode[];
    loaded?: boolean;
    expanded?: boolean;
}

interface PropertyInfo {
    name: string;
    value: string;
    type: string;
    category: string;
    readOnly?: boolean;
    deprecated?: boolean;
    hidden?: boolean;
    valueType?: string;
    valueCategory?: string;
    enumOptions?: string[];
}

interface DexExplorerProps {
    pid: number;
    username: string;
    onClose: () => void;
}

/* ─── Root services ─── */
const ROOT_SERVICES = [
    "Workspace", "Players", "Lighting", "ReplicatedFirst", "ReplicatedStorage",
    "StarterGui", "StarterPack", "StarterPlayer", "Teams", "SoundService",
    "Chat", "TextChatService", "CoreGui", "CorePackages", "VoiceChatService",
];

/* Edit state for properties */
type EditingPropState = { name: string; value: string } | null;

/* ─── Compound value parsing ─── */
const COMPOUND_FIELDS: Record<string, string[]> = {
    Vector3: ["X", "Y", "Z"],
    Vector2: ["X", "Y"],
    Color3: ["R", "G", "B"],
    UDim2: ["X.Scale", "X.Offset", "Y.Scale", "Y.Offset"],
};

/* CFrame uses grouped sub-properties: Position, RightVector, UpVector, LookVector */
interface CompoundGroup {
    label: string;
    indices: number[]; // which indices in the flat 12-value CFrame array
    subLabels: string[];
}
const CFRAME_GROUPS: CompoundGroup[] = [
    { label: "Position", indices: [0, 1, 2], subLabels: ["X", "Y", "Z"] },
    { label: "RightVector", indices: [3, 4, 5], subLabels: ["X", "Y", "Z"] },
    { label: "UpVector", indices: [6, 7, 8], subLabels: ["X", "Y", "Z"] },
    { label: "LookVector", indices: [9, 10, 11], subLabels: ["X", "Y", "Z"] },
];

function parseCompound(type: string, value: string): { label: string; val: string }[] | null {
    const fields = COMPOUND_FIELDS[type];
    if (!fields) return null;
    const parts = value.split(/,\s*/).map(s => s.trim());
    if (parts.length !== fields.length) return null;
    return fields.map((f, i) => ({ label: f, val: parts[i] || "0" }));
}

function parseCFrame(value: string): string[] | null {
    const parts = value.split(/,\s*/).map(s => s.trim());
    if (parts.length !== 12) return null;
    return parts;
}

function rebuildCompound(_type: string, subValues: string[]): string {
    return subValues.join(", ");
}

const INSTANCE_TYPES = new Set(["Instance", "Object"]);

/** Strip [index] suffix from names for display purposes */
function stripIndex(name: string): string {
    return name.replace(/\[\d+\]$/, "");
}

/**
 * Convert internal path like `game.Workspace.map.Model[2]`
 * to proper Lua path:
 * - Workspace → `workspace`
 * - Other services → `game:GetService("ServiceName")`
 * - Duplicate siblings with [N] → `:GetChildren()[N]` on parent
 * - Player name → `LocalPlayer` substitution
 */
function formatCopyPath(path: string, username?: string): string {
    // Nil instance copy path — use GetNil snippet with GetDebugId
    if (path.startsWith("nil.")) {
        const segments = path.split(".");
        const debugId = segments[1]; // The debugId of the root nil instance
        // For root nil instances: GetNil(name, debugId)
        // For children of nil instances, we build a chain
        let result = `local function GetNil(Name, DebugId)\n    for _, Object in getnilinstances() do\n        if Object.Name == Name and Object:GetDebugId() == DebugId then\n            return Object\n        end\n    end\nend\nGetNil("__NIL_NAME__", "${debugId}")`;
        // Append child path if deeper than root
        for (let i = 2; i < segments.length; i++) {
            const seg = segments[i];
            const idxMatch = seg.match(/^(.+)\[(\d+)\]$/);
            if (idxMatch) {
                const name = idxMatch[1];
                const idx = parseInt(idxMatch[2], 10);
                if (idx === 1) {
                    result += "." + name;
                } else {
                    result += `:GetChildren()[${idx}]`;
                }
            } else {
                result += "." + seg;
            }
        }
        return result;
    }

    const segments = path.split(".");
    if (segments.length < 2) return path;

    const service = stripIndex(segments[1]);
    // Always use game:GetService("X") for all services
    let result = `game:GetService("${service}")`;

    // Build each remaining segment
    for (let i = 2; i < segments.length; i++) {
        const seg = segments[i];
        const idxMatch = seg.match(/^(.+)\[(\d+)\]$/);
        if (idxMatch) {
            const name = idxMatch[1];
            const idx = parseInt(idxMatch[2], 10);
            if (idx === 1) {
                result += "." + name;
            } else {
                // Duplicate — use :GetChildren()[N]
                result += `:GetChildren()[${idx}]`;
            }
        } else {
            result += "." + seg;
        }
    }

    // Replace player name with LocalPlayer (like clth)
    if (username) {
        const playerPrefix = `game:GetService("Players").${username}`;
        if (result.startsWith(playerPrefix)) {
            result = result.replace(playerPrefix, 'game:GetService("Players").LocalPlayer');
        }
    }

    return result;
}

function isInstanceProp(prop: PropertyInfo): boolean {
    if (prop.type === "Instance") return true;
    if (prop.valueCategory === "Class") return true;
    return prop.valueType ? INSTANCE_TYPES.has(prop.valueType) : false;
}

let _reqCounter = 0;
function nextReqId() { return `dex_${++_reqCounter}_${Date.now()}`; }

// BrickColor name → [R, G, B] (0-255)
const BRICK_COLORS: Record<string, [number, number, number]> = {
    "White": [242,243,243], "Grey": [161,165,162], "Light yellow": [249,233,153], "Brick yellow": [215,197,154],
    "Light green (Mint)": [194,218,184], "Light reddish violet": [232,186,200], "Pastel Blue": [128,187,219],
    "Light orange brown": [203,132,66], "Nougat": [204,142,105], "Bright red": [196,40,28], "Med. reddish violet": [200,80,96],
    "Bright blue": [13,105,172], "Bright yellow": [245,205,48], "Earth orange": [98,71,50], "Black": [27,42,53],
    "Dark grey": [99,95,98], "Dark green": [39,70,45], "Medium green": [161,196,140], "Lig. Yellowich orange": [243,207,155],
    "Bright green": [75,151,75], "Dark orange": [160,95,53], "Light bluish violet": [193,202,222],
    "Transparent": [238,238,238], "Tr. Red": [205,84,75], "Tr. Lg blue": [193,223,240], "Tr. Blue": [123,182,232],
    "Tr. Yellow": [247,241,141], "Light blue": [180,210,228], "Tr. Flu. Reddish orange": [225,164,112],
    "Tr. Green": [132,182,141], "Tr. Flu. Green": [248,241,132], "Phosph. White": [236,232,222],
    "Light red": [238,196,182], "Medium red": [218,134,122], "Medium blue": [110,153,202],
    "Light grey": [194,193,190], "Bright violet": [107,50,124], "Br. yellowish orange": [226,155,64],
    "Bright orange": [218,133,65], "Bright bluish green": [0,143,156], "Earth yellow": [105,98,73],
    "Bright bluish violet": [53,46,158], "Tr. Brown": [191,183,177], "Medium bluish violet": [104,116,172],
    "Tr. Medi. reddish violet": [229,173,200], "Med. yellowish green": [199,210,60], "Med. bluish green": [85,165,175],
    "Light bluish green": [183,215,213], "Br. yellowish green": [164,189,71], "Lig. yellowich green": [217,228,167],
    "Med. yellowish orange": [231,172,88], "Br. reddish orange": [211,111,76], "Bright reddish violet": [146,57,120],
    "Light orange": [228,173,102], "Tr. Bright bluish violet": [165,165,203], "Gold": [220,188,129],
    "Dark nougat": [174,122,89], "Silver": [156,163,168], "Neon orange": [213,115,61], "Neon green": [216,221,86],
    "Sand blue": [116,134,157], "Sand violet": [135,124,144], "Medium orange": [227,160,91],
    "Sand yellow": [137,125,98], "Earth blue": [32,58,86], "Earth green": [39,70,45], "Tr. Flu. Blue": [207,226,247],
    "Sand blue metallic": [121,136,161], "Sand violet metallic": [149,137,149], "Sand yellow metallic": [147,135,103],
    "Dark grey metallic": [87,88,87], "Black metallic": [22,29,50], "Light grey metallic": [171,173,172],
    "Sand green": [120,144,130], "Sand red": [149,103,99], "Dark red": [114,14,15], "Tr. Flu. Yellow": [255,246,123],
    "Tr. Flu. Red": [225,164,112], "Gun metallic": [108,110,104], "Red flip/flop": [112,78,56],
    "Yellow flip/flop": [137,128,26], "Silver flip/flop": [137,135,136], "Curry": [221,196,142],
    "Fire Yellow": [249,214,46], "Flame yellowish orange": [232,171,45], "Reddish brown": [105,64,40],
    "Flame reddish orange": [207,96,36], "Medium stone grey": [163,162,165], "Royal blue": [70,103,164],
    "Dark Royal blue": [35,71,139], "Bright reddish lilac": [142,66,133], "Dark stone grey": [99,95,98],
    "Lemon metalic": [150,148,41], "Light stone grey": [229,228,223], "Dark Curry": [176,142,68],
    "Faded green": [112,149,120], "Turquoise": [121,181,181], "Light Royal blue": [159,195,233],
    "Medium Royal blue": [108,152,210], "Brown": [84,52,36],
    "Reddish lilac": [150,85,159], "Lilac": [138,121,168], "Light lilac": [189,178,209],
    "Bright purple": [205,98,152], "Light purple": [228,173,200], "Light pink": [220,144,149],
    "Light brick yellow": [233,218,188], "Warm yellowish orange": [234,184,146], "Cool yellow": [253,234,141],
    "Dove blue": [132,182,222], "Medium lilac": [68,26,145], "Slime green": [128,187,68],
    "Smoky grey": [91,93,105], "Dark blue": [0,32,78], "Parsley green": [36,91,33],
    "Steel blue": [130,138,93], "Storm blue": [51,88,130], "Lapis": [16,42,220],
    "Dark indigo": [52,43,117], "Sea green": [52,142,64], "Shamrock": [91,154,76],
    "Fossil": [159,161,172], "Mulberry": [89,34,89], "Forest green": [31,128,29],
    "Cadet blue": [159,173,192], "Electric blue": [9,137,207], "Eggplant": [123,0,123],
    "Moss": [124,156,107], "Artichoke": [138,171,133], "Sage green": [184,195,154],
    "Ghost grey": [203,203,203], "Plum": [123,47,123],
    "Olivine": [148,190,129], "Laurel green": [168,189,153], "Quill grey": [224,224,224],
    "Crimson": [151,0,0], "Mint": [175,221,185], "Baby blue": [152,194,219],
    "Carnation pink": [255,152,220], "Persimmon": [255,89,89], "Maroon": [117,0,0],
    "Daisy orange": [248,217,109], "Pearl": [231,231,236],
    "Fog": [199,212,228], "Salmon": [255,148,148], "Terra Cotta": [190,104,98],
    "Cocoa": [85,52,43], "Wheat": [242,218,164], "Buttermilk": [254,243,187],
    "Mauve": [224,178,208], "Sunrise": [215,175,125], "Tawny": [150,85,85],
    "Rust": [131,74,39], "Cashmere": [211,190,150], "Khaki": [226,220,188],
    "Lily white": [237,234,234], "Seashell": [233,218,218], "Burgundy": [136,62,62],
    "Cork": [188,155,93], "Burlap": [199,172,120], "Beige": [204,185,141],
    "Oyster": [187,179,178], "Pine Cone": [108,88,75], "Fawn brown": [160,132,79],
    "Hurricane grey": [149,137,136], "Cloudy grey": [171,168,158], "Linen": [175,148,131],
    "Copper": [150,103,102], "Dirt brown": [85,66,35], "Bronze": [126,104,63],
    "Flint": [105,102,92], "Dark taupe": [73,68,57], "Burnt Sienna": [138,82,48],
    "Institutional white": [248,248,248], "Mid gray": [205,205,205], "Really black": [17,17,17],
    "Really red": [255,0,0], "Deep orange": [255,175,0], "Alder": [180,128,55],
    "Dusty Rose": [163,75,75], "Olive": [193,190,66], "New Yeller": [255,255,0],
    "Really blue": [0,0,255], "Navy blue": [0,32,96], "Deep blue": [33,84,185],
    "Cyan": [1,175,221], "CGA brown": [170,85,0], "Magenta": [170,0,170],
    "Pink": [255,102,204], "Teal": [0,128,128],
    "Toothpaste": [0,255,255], "Lime green": [0,255,0], "Camo": [58,125,21],
    "Grime": [127,142,100], "Lavender": [163,162,165], "Pastel light blue": [175,190,218],
    "Pastel orange": [255,201,149], "Pastel violet": [177,167,255], "Pastel blue-green": [129,197,212],
    "Pastel green": [204,255,204], "Pastel yellow": [255,255,204], "Pastel brown": [255,204,153],
    "Royal purple": [98,37,209], "Hot pink": [255,0,191],
};

export default function DexExplorerPanel({ pid, username, onClose }: DexExplorerProps) {
    const [icons, setIcons] = useState<Record<string, string>>({});
    const [iconsLoading, setIconsLoading] = useState(true);
    const [tree, setTree] = useState<TreeNode[]>([]);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const lastClickedPath = useRef<string | null>(null);
    const [properties, setProperties] = useState<PropertyInfo[]>([]);
    const [propsLoading, setPropsLoading] = useState(false);
    const [showHidden, setShowHidden] = useState(false);
    const [showDeprecated, setShowDeprecated] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [propSearch, setPropSearch] = useState("");
    const [searchResults, setSearchResults] = useState<TreeNode[]>([]);
    const [searching, setSearching] = useState(false);
    const [copiedPath, setCopiedPath] = useState(false);
    const [editingPath, setEditingPath] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const [propsPanelHeight, setPropsPanelHeight] = useState(200);
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
    const [editingProp, setEditingProp] = useState<EditingPropState>(null);
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
    const [expandedProps, setExpandedProps] = useState<Set<string>>(new Set());
    const [pickingInstanceProp, setPickingInstanceProp] = useState<string | null>(null);
    const [liveProperties, setLiveProperties] = useState(false);
    const [draggingPath, setDraggingPath] = useState<string | null>(null);
    const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
    const resizing = useRef(false);
    const pendingRequests = useRef<Map<string, (data: any) => void>>(new Map());
    const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reloadNodeRef = useRef<((path: string) => Promise<void>) | null>(null);
    const treeRef = useRef<TreeNode[]>([]);
    const treeScrollRef = useRef<HTMLDivElement>(null);
    const dragScrollRAF = useRef<number | null>(null);
    const selectedSearchKey = useRef<string | null>(null);
    const searchPathClasses = useRef<Record<string, string>>({});
    const collapsedSearchPrefixes = useRef<Set<string>>(new Set());
    const dexClipboard = useRef<{ path: string; isCut: boolean } | null>(null);
    const [colorPickerProp, setColorPickerProp] = useState<{ name: string; r: number; g: number; b: number; posX: number; posY: number; isBrickColor?: boolean } | null>(null);
    const [disconnected, setDisconnected] = useState(false);
    const [viewingObject, setViewingObject] = useState<string | null>(null);
    const [clickToSelect, setClickToSelect] = useState(false);
    const [clickSelectTask, setClickSelectTask] = useState<{ segs: string[]; step: number; path: string } | null>(null);

    /* ─── Instant disconnect/reconnect signal from C# ─── */
    useEffect(() => {
        (window as any).__onDexConnectionStatus = (connected: boolean) => {
            setDisconnected(!connected);
            if (connected) {
                // Reconnected — reset tree to fresh state so it rebuilds from the new game
                const gameNode: TreeNode = {
                    name: "game", className: "DataModel", path: "game",
                    hasChildren: true, loaded: true, expanded: true,
                    children: ROOT_SERVICES.map(name => ({
                        name, className: name, path: `game.${name}`,
                        hasChildren: true, loaded: false, expanded: false,
                    })),
                };
                const nilNode: TreeNode = {
                    name: "Nil Instances", className: "Folder", path: "nil",
                    hasChildren: true, loaded: false, expanded: false,
                };
                setTree([gameNode, nilNode]);
                setSelectedPath(null);
                setSelectedPaths(new Set());
                setProperties([]);
                setSearchQuery("");
                setSearchResults([]);
                setViewingObject(null);
                setClickToSelect(false);
                // Clean up click-to-select handler if active
                if ((window as any).__cpts_handler) {
                    fsBridge.offDexData((window as any).__cpts_handler);
                    delete (window as any).__cpts_handler;
                }
            }
        };
        return () => { delete (window as any).__onDexConnectionStatus; };
    }, []);

    /* ─── Close dropdown on outside click or scroll ─── */
    useEffect(() => {
        if (!dropdownPos) return;
        const close = () => { setEditingProp(null); setDropdownPos(null); };
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('[data-dropdown]')) return;
            close();
        };
        const onScroll = (e: Event) => {
            // Don't close if scrolling inside the dropdown itself
            const target = e.target as HTMLElement;
            if (target && target.closest && target.closest('[data-dropdown]')) return;
            close();
        };
        window.addEventListener('mousedown', onMouseDown);
        document.addEventListener('scroll', onScroll, true);
        return () => {
            window.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [dropdownPos]);

    /* ─── Close color picker on outside click ─── */
    useEffect(() => {
        if (!colorPickerProp) return;
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest && target.closest('[data-colorpicker]')) return;
            setColorPickerProp(null);
        };
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setColorPickerProp(null); };
        window.addEventListener('mousedown', onMouseDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [colorPickerProp]);

    /* ─── DEX data listener ─── */
    // Sync refs at render time — always up to date
    treeRef.current = tree;

    // Live events: directly splice add/remove into the tree
    const pendingLiveEvents = useRef<Array<{ action: string; parentPath: string; name: string; className?: string; hasChildren?: boolean }>>([]);
    const liveDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const applyLiveEvents = useCallback(() => {
        const events = pendingLiveEvents.current;
        pendingLiveEvents.current = [];
        if (events.length === 0) return;

        // Diagnostic: accumulate all workspace-related events across batches
        const expandedNodes: string[] = [];
        const walkDiag = (ns: TreeNode[]) => {
            for (const n of ns) {
                if (n.expanded && n.loaded) expandedNodes.push(n.path);
                if (n.children) walkDiag(n.children);
            }
        };
        walkDiag(treeRef.current);
        
        // Keep accumulating workspace event paths (filter to only Workspace-related for brevity)
        const prev = (window as any).__dexSpliceDiag || { allPaths: [], batchCount: 0, changeCount: 0 };
        const workspaceEvents = events
            .filter(e => e.parentPath.startsWith("game.Workspace"))
            .map(e => `${e.action}:${e.parentPath}:${e.name}`);
        const allPaths = [...new Set([...prev.allPaths, ...workspaceEvents])].slice(-50);
        (window as any).__dexSpliceDiag = {
            batchCount: prev.batchCount + 1,
            totalInBatch: events.length,
            workspaceInBatch: workspaceEvents.length,
            allPaths,
            expandedLoadedNodes: expandedNodes,
            changeCount: prev.changeCount,
            timestamp: Date.now(),
        };

        setTree(prev => {
            // Returns [newNodes, didChange]
            const applyToNodes = (nodes: TreeNode[]): [TreeNode[], boolean] => {
                let anyNodeChanged = false;
                const result = nodes.map(n => {
                    let nodeChanged = false;
                    let children: TreeNode[] | undefined = n.children;

                    // If this node is targeted by events, update it
                    const matching = events.filter(e => e.parentPath === n.path);
                    if (matching.length > 0) {
                        if (n.loaded && n.expanded && children) {
                            // Expanded+loaded: splice children directly
                            children = [...children];
                            for (const evt of matching) {
                                if (evt.action === "add") {
                                    const childPath = `${n.path}.${evt.name}`;
                                    if (!children!.some(c => c.path === childPath)) {
                                        children!.push({
                                            name: evt.name,
                                            className: evt.className || "Instance",
                                            path: childPath,
                                            hasChildren: evt.hasChildren ?? false,
                                            loaded: false,
                                            expanded: false,
                                        });
                                        nodeChanged = true;
                                    }
                                } else if (evt.action === "remove") {
                                    const filtered: TreeNode[] = children!.filter(c => c.name !== evt.name);
                                    if (filtered.length !== children!.length) {
                                        children = filtered;
                                        nodeChanged = true;
                                        // If last child removed, update hasChildren
                                        if (children.length === 0) {
                                            return { ...n, children, hasChildren: false, loaded: false, expanded: false };
                                        }
                                    }
                                }
                            }
                        } else {
                            // Not expanded/loaded: just update hasChildren flag
                            for (const evt of matching) {
                                if (evt.action === "add" && !n.hasChildren) {
                                    nodeChanged = true;
                                    return { ...n, hasChildren: true };
                                }
                            }
                        }
                    }

                    // Recurse into children to handle deeper matches
                    if (children && children.length > 0) {
                        const [updatedChildren, childrenChanged] = applyToNodes(children);
                        if (childrenChanged) {
                            children = updatedChildren;
                            nodeChanged = true;
                        }
                    }

                    if (nodeChanged) {
                        anyNodeChanged = true;
                        return { ...n, children };
                    }
                    return n;
                });
                return [result, anyNodeChanged];
            };

            const [result, didChange] = applyToNodes(prev);
            if (didChange) (window as any).__dexSpliceDiag.changeCount++;
            return didChange ? result : prev;
        });
    }, []);

    useEffect(() => {
        const handler = (_pid: number, data: any) => {
            if (_pid !== pid) return;
            // Handle live tree events — directly splice add/remove into tree
            if (data?.type === "dex_liveEvents" && data?.events) {
                const ROOT_SERVICES_SET = new Set(["Workspace", "Players", "ReplicatedStorage", "ReplicatedFirst",
                    "ServerStorage", "ServerScriptService", "StarterGui", "StarterPack", "StarterPlayer",
                    "Lighting", "SoundService", "Chat", "LocalizationService", "TestService",
                    "TextChatService", "MaterialService", "CoreGui"]);

                for (const e of data.events) {
                    const pp = e.parentPath as string;
                    const parts = pp.split(".");
                    if (parts.length >= 2 && parts[0] === "game" && ROOT_SERVICES_SET.has(parts[1])) {
                        pendingLiveEvents.current.push({
                            action: e.action,
                            parentPath: pp,
                            name: e.name,
                            className: e.className,
                            hasChildren: e.hasChildren,
                        });
                    }
                }

                // Debounce: batch events over 200ms
                if (liveDebounceTimer.current) clearTimeout(liveDebounceTimer.current);
                liveDebounceTimer.current = setTimeout(() => {
                    liveDebounceTimer.current = null;
                    applyLiveEvents();
                }, 200);
                return;
            }
            // Handle live property updates
            if (data?.type === "dex_livePropertyUpdate") {
                setProperties(prev => prev.map(p =>
                    p.name === data.propName
                        ? { ...p, value: data.value, type: data.propType || p.type }
                        : p
                ));
                return;
            }
            const reqId = data?.requestId;
            if (reqId && pendingRequests.current.has(reqId)) {
                pendingRequests.current.get(reqId)!(data);
                pendingRequests.current.delete(reqId);
            }
        };
        fsBridge.onDexData(handler);
        return () => { fsBridge.offDexData(handler); };
    }, [pid, applyLiveEvents]);

    /* ─── Send request w/ response ─── */
    const sendRequest = useCallback((type: string, data: Record<string, unknown> = {}): Promise<any> => {
        return new Promise((resolve) => {
            const requestId = nextReqId();
            const timeout = setTimeout(() => {
                pendingRequests.current.delete(requestId);
                setDisconnected(true);
                resolve(null);
            }, 10000);
            pendingRequests.current.set(requestId, (result: any) => {
                clearTimeout(timeout);
                setDisconnected(false);
                resolve(result);
            });
            fsBridge.dexRequest(pid, type, { ...data, requestId });
        });
    }, [pid]);

    /* ─── Load icons ─── */
    useEffect(() => {
        (async () => {
            setIconsLoading(true);
            await fsBridge.ensureDexIcons();
            const result = await fsBridge.getDexIcons();
            if (result?.ok && result.icons) {
                setIcons(result.icons);
            }
            setIconsLoading(false);
        })();
    }, []);

    /* ─── Root tree ─── */
    useEffect(() => {
        if (iconsLoading) return;
        const gameNode: TreeNode = {
            name: "game", className: "DataModel", path: "game",
            hasChildren: true, loaded: true, expanded: true,
            children: ROOT_SERVICES.map(name => ({
                name, className: name, path: `game.${name}`,
                hasChildren: true, loaded: false, expanded: false,
            })),
        };
        const nilNode: TreeNode = {
            name: "Nil Instances", className: "Folder", path: "nil",
            hasChildren: true, loaded: false, expanded: false,
        };
        setTree([gameNode, nilNode]);
    }, [iconsLoading]);

    // Keep treeRef in sync for the live update handler
    useEffect(() => { treeRef.current = tree; }, [tree]);

    /* ─── Expand / collapse ─── */
    const toggleExpand = useCallback(async (path: string, forceExpand?: boolean) => {
        const findNode = (nodes: TreeNode[]): TreeNode | undefined => {
            for (const n of nodes) {
                if (n.path === path) return n;
                if (n.children) { const f = findNode(n.children); if (f) return f; }
            }
            return undefined;
        };
        const node = findNode(tree);
        if (node && !node.loaded) {
            const result = await sendRequest("dex_getChildren", { path });
            if (result?.children) {
                // Track name counts to deduplicate paths for same-named siblings
                const nameCounts: Record<string, number> = {};
                const children: TreeNode[] = result.children.map((c: any) => {
                    const count = nameCounts[c.name] || 0;
                    nameCounts[c.name] = count + 1;
                    let childPath: string;
                    if (path === "nil" && c.debugId) {
                        // Root nil instance children use debugId as path key
                        childPath = `nil.${c.debugId}`;
                    } else {
                        childPath = count > 0 ? `${path}.${c.name}[${count}]` : `${path}.${c.name}`;
                    }
                    return {
                        name: c.name, className: c.className,
                        path: childPath, hasChildren: c.hasChildren,
                        loaded: false, expanded: false,
                        debugId: c.debugId,
                    };
                });
                setTree(prev => {
                    const u = (nodes: TreeNode[]): TreeNode[] =>
                        nodes.map(n => {
                            if (n.path === path) return { ...n, loaded: true, expanded: true, children };
                            if (n.children) return { ...n, children: u(n.children) };
                            return n;
                        });
                    return u(prev);
                });
            }
        } else {
            setTree(prev => {
                const u = (nodes: TreeNode[]): TreeNode[] =>
                    nodes.map(n => {
                        if (n.path === path) return { ...n, expanded: forceExpand ? true : !n.expanded };
                        if (n.children) return { ...n, children: u(n.children) };
                        return n;
                    });
                return u(prev);
            });
        }
    }, [tree, sendRequest]);

    /* ─── Select children ─── */
    const selectChildrenOf = useCallback(async (path: string) => {
        const findNode = (nodes: TreeNode[]): TreeNode | undefined => {
            for (const n of nodes) {
                if (n.path === path) return n;
                if (n.children) { const f = findNode(n.children); if (f) return f; }
            }
            return undefined;
        };
        let node = findNode(tree);
        // If children aren't loaded, load them first
        if (node && !node.loaded) {
            await toggleExpand(path);
            node = findNode(treeRef.current);
        }
        if (node?.children && node.children.length > 0) {
            const childPaths = new Set(node.children.map(c => c.path));
            setSelectedPaths(childPaths);
            setSelectedPath(node.children[0].path);
            lastClickedPath.current = node.children[0].path;
        }
    }, [tree, toggleExpand]);

    /* ─── Helper: generate Lua code to resolve a tree path to a variable ─── */
    const luaResolve = (varName: string, path: string) => {
        if (path.startsWith("nil.")) {
            // Nil instance path resolution
            const parts = path.split(".");
            const debugId = parts[1]; // root nil instance debugId
            let code = `local ${varName} = nil
for _, obj in getnilinstances() do
    if obj:GetDebugId() == "${debugId}" then ${varName} = obj; break end
end
if not ${varName} then error("nil instance not found") end`;
            // Traverse children if path is deeper
            if (parts.length > 2) {
                const childParts = parts.slice(2);
                code += `\nfor _, part in {"${childParts.join('","')}"} do
    local name, idx = part:match("^(.-)%[(%d+)%]$")
    if name then
        idx = tonumber(idx)
        local count = 0
        local found = false
        for _, child in ipairs(${varName}:GetChildren()) do
            if child.Name == name then
                count = count + 1
                if count == idx then ${varName} = child; found = true; break end
            end
        end
        if not found then error("not found") end
    else
        ${varName} = ${varName}:FindFirstChild(part)
        if not ${varName} then error("not found") end
    end
end`;
            }
            return code;
        }
        const parts = path.split(".").slice(1); // remove "game"
        return `local ${varName} = game
for _, part in {"${parts.join('","')}"} do
    local name, idx = part:match("^(.-)%[(%d+)%]$")
    if name then
        idx = tonumber(idx)
        local count = 0
        local found = false
        for _, child in ipairs(${varName}:GetChildren()) do
            if child.Name == name then
                count = count + 1
                if count == idx then ${varName} = child; found = true; break end
            end
        end
        if not found then error("not found") end
    else
        local ok, svc = pcall(function() return game:GetService(part) end)
        if ok and svc then ${varName} = svc
        else ${varName} = ${varName}:FindFirstChild(part) end
        if not ${varName} then error("not found") end
    end
end`;
    };

    /* ─── Insert object ─── */
    const insertObject = useCallback((parentPath: string, className: string) => {
        fsBridge.executeOnClients([pid], `pcall(function()
${luaResolve("target", parentPath)}
local inst = Instance.new("${className}", target)
if inst:IsA("BasePart") then
    inst.Anchored = true
    local plr = game:GetService("Players").LocalPlayer
    local char = plr and plr.Character
    local hrp = char and char:FindFirstChild("HumanoidRootPart")
    if hrp then inst.Position = (hrp.CFrame * CFrame.new(0, 0, -10)).Position end
elseif inst:IsA("GuiObject") then
    inst.Active = true
    if inst.Parent:IsA("ScreenGui") then inst.Position = UDim2.new(0.5, 0, 0.5, 0) end
end
end)`);
    }, [pid]);

    /* ─── Select → load props ─── */
    /* ─── Set property ─── */
    const sendSetProperty = useCallback(async (path: string, propName: string, newValue: string) => {
        console.log("[DEX] setProperty:", { path, propName, value: newValue });
        const setResult = await sendRequest("dex_setProperty", { path, propName, value: newValue });
        console.log("[DEX] setProperty result:", setResult);
        // Refresh properties after setting
        const result = await sendRequest("dex_getProperties", { path, showHidden, showDeprecated });
        if (result?.properties) setProperties(result.properties);
    }, [sendRequest, showHidden, showDeprecated]);

    /* ─── Reload a tree node's children (force re-fetch) ─── */
    const reloadNode = useCallback(async (path: string) => {
        const result = await sendRequest("dex_getChildren", { path });
        if (result?.children) {
            const nameCounts: Record<string, number> = {};
            setTree(prev => {
                // Find the existing node to preserve child state
                const findNode = (nodes: TreeNode[]): TreeNode | undefined => {
                    for (const n of nodes) {
                        if (n.path === path) return n;
                        if (n.children) { const f = findNode(n.children); if (f) return f; }
                    }
                    return undefined;
                };
                const existingNode = findNode(prev);
                const existingChildMap = new Map<string, TreeNode>();
                if (existingNode?.children) {
                    for (const c of existingNode.children) {
                        existingChildMap.set(c.path, c);
                    }
                }

                const children: TreeNode[] = result.children.map((c: any) => {
                    const count = nameCounts[c.name] || 0;
                    nameCounts[c.name] = count + 1;
                    const childPath = count > 0 ? `${path}.${c.name}[${count}]` : `${path}.${c.name}`;
                    // Preserve existing expanded/loaded state and sub-children
                    const existing = existingChildMap.get(childPath);
                    if (existing) {
                        return { ...existing, name: c.name, className: c.className, hasChildren: c.hasChildren };
                    }
                    return { name: c.name, className: c.className, path: childPath, hasChildren: c.hasChildren, loaded: false, expanded: false };
                });

                const u = (nodes: TreeNode[]): TreeNode[] =>
                    nodes.map(n => {
                        if (n.path === path) return { ...n, loaded: true, expanded: n.expanded, children };
                        if (n.children) return { ...n, children: u(n.children) };
                        return n;
                    });
                return u(prev);
            });
        }
    }, [sendRequest]);

    // Keep ref to reloadNode for the data listener (render-time sync)
    reloadNodeRef.current = reloadNode;

    /* ─── Select → load props ─── */
    const selectNode = useCallback(async (path: string, opts?: { ctrl?: boolean; shift?: boolean }) => {
        if (opts?.ctrl) {
            // Ctrl+click: toggle this path in multi-selection
            setSelectedPaths(prev => {
                const next = new Set(prev);
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return next;
            });
            setSelectedPath(path);
            lastClickedPath.current = path;
        } else if (opts?.shift && lastClickedPath.current) {
            // Shift+click: range select between last clicked and current
            const flatPaths: string[] = [];
            const flattenTree = (nodes: TreeNode[]) => {
                for (const n of nodes) {
                    flatPaths.push(n.path);
                    if (n.expanded && n.children) flattenTree(n.children);
                }
            };
            flattenTree(tree);
            const startIdx = flatPaths.indexOf(lastClickedPath.current);
            const endIdx = flatPaths.indexOf(path);
            if (startIdx >= 0 && endIdx >= 0) {
                const lo = Math.min(startIdx, endIdx);
                const hi = Math.max(startIdx, endIdx);
                setSelectedPaths(new Set(flatPaths.slice(lo, hi + 1)));
            }
            setSelectedPath(path);
        } else {
            // Normal click: single select
            setSelectedPaths(new Set([path]));
            setSelectedPath(path);
            lastClickedPath.current = path;
        }
        setEditingProp(null);
        setPropsLoading(true);
        const result = await sendRequest("dex_getProperties", { path, showHidden, showDeprecated });
        if (result?.properties) setProperties(result.properties);
        setPropsLoading(false);
    }, [sendRequest, showHidden, showDeprecated, tree]);

    /* ─── Click-to-select: step-by-step expansion with fresh refs ─── */
    useEffect(() => {
        if (!clickSelectTask) return;
        const { segs, step, path } = clickSelectTask;

        if (step >= segs.length) {
            // All ancestors expanded — select + scroll
            setClickSelectTask(null);
            selectNode(path);
            // Retry scroll until element renders
            let attempts = 0;
            const tryScroll = () => {
                const el = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
                if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                } else if (attempts < 15) {
                    attempts++;
                    setTimeout(tryScroll, 150);
                }
            };
            setTimeout(tryScroll, 100);
            return;
        }

        // Expand one level using fresh sendRequest
        const seg = segs[step];
        const expandPath = step === 0 ? "game" : "game." + segs.slice(0, step).join(".");
        const nextPath = expandPath + "." + seg;
        (async () => {
            const result = await sendRequest("dex_getChildren", { path: expandPath });
            if (result?.children) {
                const nameCounts: Record<string, number> = {};
                const children: TreeNode[] = result.children.map((c: any) => {
                    const count = nameCounts[c.name] || 0;
                    nameCounts[c.name] = count + 1;
                    const childPath = count > 0 ? `${expandPath}.${c.name}[${count}]` : `${expandPath}.${c.name}`;
                    return { name: c.name, className: c.className, path: childPath, hasChildren: c.hasChildren, loaded: false, expanded: false };
                });
                setTree(prev => {
                    const u = (nodes: TreeNode[]): TreeNode[] =>
                        nodes.map(n => {
                            if (n.path === expandPath) return { ...n, loaded: true, expanded: true, children };
                            if (n.children) return { ...n, children: u(n.children) };
                            return n;
                        });
                    return u(prev);
                });
            }
            // Advance to next step (triggers re-render → fresh refs → next useEffect call)
            setClickSelectTask({ segs, step: step + 1, path: nextPath });
        })();
    }, [clickSelectTask, sendRequest, selectNode]);


    /* ─── Live property watching ─── */
    useEffect(() => {
        if (liveProperties && selectedPath) {
            fsBridge.dexRequest(pid, "dex_watchProperties", { path: selectedPath });
        } else {
            fsBridge.dexRequest(pid, "dex_unwatchProperties", {});
        }
        return () => {
            fsBridge.dexRequest(pid, "dex_unwatchProperties", {});
        };
    }, [liveProperties, selectedPath, pid]);

    /* ─── Search ─── */
    const [, forceSearchRerender] = useState(0);
    useEffect(() => {
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        if (!searchQuery || searchQuery.length < 2) { setSearchResults([]); setSearching(false); searchPathClasses.current = {}; collapsedSearchPrefixes.current.clear(); return; }
        setSearching(true);
        searchTimeout.current = setTimeout(async () => {
            const result = await sendRequest("dex_search", { query: searchQuery });
            if (result?.results) {
                const mapped = result.results.map((r: any) => ({
                    name: r.name, className: r.className, path: r.path, hasChildren: false,
                    parentClasses: r.parentClasses || [],
                }));
                setSearchResults(mapped);

                // Collect unique ancestor paths that need className resolution
                // Group them by parent path so we can use dex_getChildren (existing Lua endpoint)
                const ancestorPaths = new Set<string>();
                for (const r of mapped) {
                    const segments = r.path.split(".");
                    for (let d = 1; d < segments.length - 1; d++) {
                        ancestorPaths.add(segments.slice(0, d + 1).join("."));
                    }
                }
                // Group ancestors by parent path→child name
                const parentPaths = new Set<string>();
                for (const ap of ancestorPaths) {
                    const lastDot = ap.lastIndexOf(".");
                    if (lastDot > 0) parentPaths.add(ap.substring(0, lastDot));
                }
                // Fetch children for each unique parent path in parallel
                if (parentPaths.size > 0) {
                    const resolves = Array.from(parentPaths).map(pp =>
                        sendRequest("dex_getChildren", { path: pp }).then((res: any) => ({ parentPath: pp, children: res?.children || [] }))
                    );
                    const allResults = await Promise.all(resolves);
                    const classMap: Record<string, string> = {};
                    for (const { parentPath, children } of allResults) {
                        for (const child of children) {
                            classMap[`${parentPath}.${child.name}`] = child.className;
                        }
                    }
                    searchPathClasses.current = classMap;
                    forceSearchRerender(c => c + 1);
                }
            }
            setSearching(false);
        }, 400);
    }, [searchQuery, sendRequest]);

    /* ─── Re-fetch properties when showHidden/showDeprecated toggles ─── */
    useEffect(() => {
        if (!selectedPath) return;
        setPropsLoading(true);
        sendRequest("dex_getProperties", { path: selectedPath, showHidden, showDeprecated }).then(result => {
            if (result?.properties) setProperties(result.properties);
            setPropsLoading(false);
        });
    }, [showHidden, showDeprecated]); // eslint-disable-line react-hooks/exhaustive-deps


    /* ─── Resize ─── */
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        resizing.current = true;
        const startY = e.clientY;
        const startH = propsPanelHeight;
        const onMove = (ev: MouseEvent) => {
            if (!resizing.current) return;
            setPropsPanelHeight(Math.max(200, Math.min(500, startH + (startY - ev.clientY))));
        };
        const onUp = () => { resizing.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, [propsPanelHeight]);

    /* ─── Icon ─── */
    const getIcon = (className: string) => {
        if (icons[className]) return <img src={icons[className]} alt="" className="w-4 h-4 shrink-0" draggable={false} />;
        return <FolderTree className="w-3.5 h-3.5 text-white/20 shrink-0" />;
    };

    const filteredProps = properties
        .filter(p => showDeprecated || !p.deprecated)
        .filter(p => !propSearch || p.name.toLowerCase().includes(propSearch.toLowerCase()));

    /* ─── Expand all from a node ─── */
    const expandAllFrom = useCallback(async (path: string) => {
        const expandRecursive = async (nodePath: string) => {
            const result = await sendRequest("dex_getChildren", { path: nodePath });
            if (!result?.children) return;
            const children: TreeNode[] = result.children.map((c: any) => ({
                name: c.name, className: c.className,
                path: `${nodePath}.${c.name}`, hasChildren: c.hasChildren,
                loaded: false, expanded: false,
            }));
            setTree(prev => {
                const u = (nodes: TreeNode[]): TreeNode[] =>
                    nodes.map(n => {
                        if (n.path === nodePath) return { ...n, loaded: true, expanded: true, children };
                        if (n.children) return { ...n, children: u(n.children) };
                        return n;
                    });
                return u(prev);
            });
            for (const child of children) {
                if (child.hasChildren) await expandRecursive(child.path);
            }
        };
        await expandRecursive(path);
    }, [sendRequest]);

    /* ─── Collapse all from a node ─── */
    const collapseAllFrom = useCallback((path: string) => {
        setTree(prev => {
            const u = (nodes: TreeNode[]): TreeNode[] =>
                nodes.map(n => {
                    if (n.path === path || n.path.startsWith(path + ".")) {
                        return { ...n, expanded: false, children: n.children ? u(n.children) : undefined };
                    }
                    if (n.children) return { ...n, children: u(n.children) };
                    return n;
                });
            return u(prev);
        });
    }, []);


    useEffect(() => {
        (window as any).__dexContextMenuAction = (data: any) => {
            const { action, path, treePath, name, className } = data;
            switch (action) {
                case "copyPath":
                    navigator.clipboard.writeText(formatCopyPath(path, username).replace("__NIL_NAME__", name));
                    break;
                case "rename":
                    setEditingPath(path);
                    setEditingName(name);
                    break;
                case "jumpToParent": {
                    document.body.style.background = "blue"; setTimeout(() => document.body.style.background = "", 2000);
                    const parentPath = path.split(".").slice(0, -1).join(".");
                    if (!parentPath) break;
                    setSearchQuery("");
                    console.log("[DEX-JUMP] jumpToParent for:", parentPath);
                    (async () => {
                        const segs = parentPath.split(".");
                        for (let i = 2; i <= segs.length; i++) {
                            const ancestorPath = segs.slice(0, i).join(".");
                            const reqId = "jp_" + Date.now() + "_" + i;
                            const result = await new Promise<any>((resolve) => {
                                const timeout = setTimeout(() => resolve(null), 5000);
                                const handler = (_: any, data: any) => {
                                    if (data?.requestId === reqId) {
                                        clearTimeout(timeout);
                                        fsBridge.offDexData(handler);
                                        resolve(data);
                                    }
                                };
                                fsBridge.onDexData(handler);
                                fsBridge.dexRequest(pid, "dex_getChildren", { path: ancestorPath, requestId: reqId });
                            });
                            if (result?.children) {
                                const nameCounts: Record<string, number> = {};
                                const children: TreeNode[] = result.children.map((c: any) => {
                                    const count = nameCounts[c.name] || 0;
                                    nameCounts[c.name] = count + 1;
                                    const childPath = count > 0 ? `${ancestorPath}.${c.name}[${count}]` : `${ancestorPath}.${c.name}`;
                                    return { name: c.name, className: c.className, path: childPath, hasChildren: c.hasChildren, loaded: false, expanded: false };
                                });
                                setTree(prev => {
                                    const u = (nodes: TreeNode[]): TreeNode[] =>
                                        nodes.map(n => {
                                            if (n.path === ancestorPath) return { ...n, loaded: true, expanded: true, children };
                                            if (n.children) return { ...n, children: u(n.children) };
                                            return n;
                                        });
                                    return u(prev);
                                });
                                await new Promise(r => setTimeout(r, 50));
                            }
                        }
                        selectNode(parentPath);
                        setTimeout(() => {
                            const el = document.querySelector(`[data-path="${CSS.escape(parentPath)}"]`);
                            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                        }, 200);
                    })();
                    break;
                }
                case "selectChildren":
                    selectChildrenOf(path);
                    break;
                case "expandAll":
                    expandAllFrom(path);
                    break;
                case "collapseAll":
                    collapseAllFrom(path);
                    break;
                case "copy":
                    dexClipboard.current = { path, isCut: false };
                    break;
                case "cut": {
                    dexClipboard.current = { path, isCut: true };
                    // Atomic: clone to temp container, then destroy original
                    fsBridge.dexRequest(pid, "dex_cut", { path });
                    // Remove node from tree visually
                    setTree(prev => {
                        const remove = (nodes: TreeNode[]): TreeNode[] =>
                            nodes.filter(n => n.path !== path).map(n =>
                                n.children ? { ...n, children: remove(n.children) } : n
                            );
                        return remove(prev);
                    });
                    break;
                }
                case "pasteInto": {
                    const clip = dexClipboard.current;
                    if (!clip) break;
                    if (clip.isCut) {
                        // Paste from cut: move from temp container
                        fsBridge.dexRequest(pid, "dex_pasteFromCut", { destPath: path });
                        dexClipboard.current = null;
                    } else {
                        // Paste from copy: clone source to dest
                        fsBridge.dexRequest(pid, "dex_clone", { sourcePath: clip.path, destPath: path });
                    }
                    // Refresh target node to show new child
                    setTimeout(() => {
                        setTree(prev => {
                            const u = (nodes: TreeNode[]): TreeNode[] =>
                                nodes.map(n => {
                                    if (n.path === path) return { ...n, hasChildren: true, loaded: false, expanded: false };
                                    if (n.children) return { ...n, children: u(n.children) };
                                    return n;
                                });
                            return u(prev);
                        });
                        toggleExpand(path);
                    }, 300);
                    break;
                }
                case "duplicate": {
                    const parentPath = path.split(".").slice(0, -1).join(".");
                    if (!parentPath) break;
                    fsBridge.dexRequest(pid, "dex_clone", { sourcePath: path, destPath: parentPath });
                    // Silently reload parent children without collapsing
                    setTimeout(() => {
                        setTree(prev => {
                            const u = (nodes: TreeNode[]): TreeNode[] =>
                                nodes.map(n => {
                                    if (n.path === parentPath) return { ...n, loaded: false };
                                    if (n.children) return { ...n, children: u(n.children) };
                                    return n;
                                });
                            return u(prev);
                        });
                        // Collapse then immediately re-expand to trigger refetch
                        toggleExpand(parentPath);
                        setTimeout(() => toggleExpand(parentPath), 50);
                    }, 400);
                    break;
                }
                case "insertObject":
                    insertObject(path, className);
                    // Refresh target node to show new child
                    setTimeout(() => {
                        setTree(prev => {
                            const u = (nodes: TreeNode[]): TreeNode[] =>
                                nodes.map(n => {
                                    if (n.path === path) return { ...n, hasChildren: true, loaded: false, expanded: false };
                                    if (n.children) return { ...n, children: u(n.children) };
                                    return n;
                                });
                            return u(prev);
                        });
                        toggleExpand(path);
                    }, 300);
                    break;
                case "delete":
                    fsBridge.dexRequest(pid, "dex_destroy", { path });
                    // Remove node from tree visually
                    setTree(prev => {
                        const remove = (nodes: TreeNode[]): TreeNode[] =>
                            nodes.filter(n => n.path !== path).map(n =>
                                n.children ? { ...n, children: remove(n.children) } : n
                            );
                        return remove(prev);
                    });
                    break;
                case "teleportTo":
                    fsBridge.executeOnClients([pid], `pcall(function()
${luaResolve("target", treePath || path)}
local plr = game:GetService("Players").LocalPlayer
local char = plr and plr.Character
local hrp = char and char:FindFirstChild("HumanoidRootPart")
if not hrp then return end
if target:IsA("BasePart") then
    if target.CanCollide then char:MoveTo(target.Position) else hrp.CFrame = CFrame.new(target.Position + Vector3.new(0,3,0)) end
elseif target:IsA("Model") then
    local pp = target.PrimaryPart
    if pp then
        if pp.CanCollide then char:MoveTo(pp.Position) else hrp.CFrame = CFrame.new(pp.Position + Vector3.new(0,3,0)) end
    else
        local part = target:FindFirstChildWhichIsA("BasePart", true)
        if part then
            if part.CanCollide then char:MoveTo(part.Position) else hrp.CFrame = CFrame.new(part.Position + Vector3.new(0,3,0)) end
        end
    end
end
end)`);
                    break;
                case "viewObject":
                    fsBridge.executeOnClients([pid], `pcall(function()
${luaResolve("target", treePath || path)}
if target:IsA("BasePart") or target:IsA("Model") then
    workspace.CurrentCamera.CameraSubject = target
end
end)`);
                    setViewingObject(treePath || path);
                    break;
                case "selectLocalPlayer": {
                    const reqId = "slp_" + Date.now();
                    const handler = (_: any, data: any) => {
                        if (data?.type === "dex_charPath" && data?.requestId === reqId && data?.charPath) {
                            fsBridge.offDexData(handler);
                            const targetPath = "game." + data.charPath.replace(/^game\./, "");
                            setSearchQuery("");
                            (async () => {
                                const segs = targetPath.split(".");
                                for (let i = 2; i <= segs.length; i++) {
                                    const ancestorPath = segs.slice(0, i).join(".");
                                    const aReqId = "slp_a_" + Date.now() + "_" + i;
                                    const result = await new Promise<any>((resolve) => {
                                        const timeout = setTimeout(() => resolve(null), 5000);
                                        const h = (_: any, d: any) => {
                                            if (d?.requestId === aReqId) {
                                                clearTimeout(timeout);
                                                fsBridge.offDexData(h);
                                                resolve(d);
                                            }
                                        };
                                        fsBridge.onDexData(h);
                                        fsBridge.dexRequest(pid, "dex_getChildren", { path: ancestorPath, requestId: aReqId });
                                    });
                                    if (result?.children) {
                                        const nameCounts: Record<string, number> = {};
                                        const children: TreeNode[] = result.children.map((c: any) => {
                                            const count = nameCounts[c.name] || 0;
                                            nameCounts[c.name] = count + 1;
                                            const childPath = count > 0 ? `${ancestorPath}.${c.name}[${count}]` : `${ancestorPath}.${c.name}`;
                                            return { name: c.name, className: c.className, path: childPath, hasChildren: c.hasChildren, loaded: false, expanded: false };
                                        });
                                        setTree(prev => {
                                            const u = (nodes: TreeNode[]): TreeNode[] =>
                                                nodes.map(n => {
                                                    if (n.path === ancestorPath) return { ...n, loaded: true, expanded: true, children };
                                                    if (n.children) return { ...n, children: u(n.children) };
                                                    return n;
                                                });
                                            return u(prev);
                                        });
                                        await new Promise(r => setTimeout(r, 50));
                                    }
                                }
                                selectNode(targetPath);
                                setTimeout(() => {
                                    const el = document.querySelector(`[data-path="${CSS.escape(targetPath)}"]`);
                                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                                }, 200);
                            })();
                        }
                    };
                    fsBridge.onDexData(handler);
                    setTimeout(() => fsBridge.offDexData(handler), 10000); // cleanup after 10s
                    fsBridge.executeOnClients([pid], `pcall(function()
local plr = game:GetService("Players").LocalPlayer
if plr and plr.Character and plr.Character.Parent then
    local HttpService = game:GetService("HttpService")
    local ws = getgenv().__3itx_ws
    if ws then ws:Send(HttpService:JSONEncode({type="dex_charPath",requestId="${reqId}",charPath=plr.Character:GetFullName()})) end
end
end)`);
                    break;
                }
                case "selectCharacter": {
                    const reqId = "sc_" + Date.now();
                    const handler = (_: any, data: any) => {
                        if (data?.type === "dex_charPath" && data?.requestId === reqId && data?.charPath) {
                            fsBridge.offDexData(handler);
                            const targetPath = "game." + data.charPath.replace(/^game\./, "");
                            setSearchQuery("");
                            (async () => {
                                const segs = targetPath.split(".");
                                for (let i = 2; i <= segs.length; i++) {
                                    const ancestorPath = segs.slice(0, i).join(".");
                                    const aReqId = "sc_a_" + Date.now() + "_" + i;
                                    const result = await new Promise<any>((resolve) => {
                                        const timeout = setTimeout(() => resolve(null), 5000);
                                        const h = (_: any, d: any) => {
                                            if (d?.requestId === aReqId) {
                                                clearTimeout(timeout);
                                                fsBridge.offDexData(h);
                                                resolve(d);
                                            }
                                        };
                                        fsBridge.onDexData(h);
                                        fsBridge.dexRequest(pid, "dex_getChildren", { path: ancestorPath, requestId: aReqId });
                                    });
                                    if (result?.children) {
                                        const nameCounts: Record<string, number> = {};
                                        const children: TreeNode[] = result.children.map((c: any) => {
                                            const count = nameCounts[c.name] || 0;
                                            nameCounts[c.name] = count + 1;
                                            const childPath = count > 0 ? `${ancestorPath}.${c.name}[${count}]` : `${ancestorPath}.${c.name}`;
                                            return { name: c.name, className: c.className, path: childPath, hasChildren: c.hasChildren, loaded: false, expanded: false };
                                        });
                                        setTree(prev => {
                                            const u = (nodes: TreeNode[]): TreeNode[] =>
                                                nodes.map(n => {
                                                    if (n.path === ancestorPath) return { ...n, loaded: true, expanded: true, children };
                                                    if (n.children) return { ...n, children: u(n.children) };
                                                    return n;
                                                });
                                            return u(prev);
                                        });
                                        await new Promise(r => setTimeout(r, 50));
                                    }
                                }
                                selectNode(targetPath);
                                setTimeout(() => {
                                    const el = document.querySelector(`[data-path="${CSS.escape(targetPath)}"]`);
                                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                                }, 200);
                            })();
                        }
                    };
                    fsBridge.onDexData(handler);
                    setTimeout(() => fsBridge.offDexData(handler), 10000);
                    fsBridge.executeOnClients([pid], `pcall(function()
${luaResolve("target", treePath || path)}
if target:IsA("Player") and target.Character and target.Character.Parent then
    local HttpService = game:GetService("HttpService")
    local ws = getgenv().__3itx_ws
    if ws then ws:Send(HttpService:JSONEncode({type="dex_charPath",requestId="${reqId}",charPath=target.Character:GetFullName()})) end
end
end)`);
                    break;
                }
                case "fireTouchTransmitter":
                    fsBridge.executeOnClients([pid], `pcall(function()
${luaResolve("target", treePath || path)}
if target:IsA("TouchTransmitter") then
    local plr = game:GetService("Players").LocalPlayer
    local hrp = plr and plr.Character and plr.Character:FindFirstChild("HumanoidRootPart")
    if hrp then firetouchinterest(hrp, target.Parent, 0) end
end
end)`);
                    break;
                case "fireClickDetector":
                    fsBridge.executeOnClients([pid], `pcall(function()
${luaResolve("target", treePath || path)}
if target:IsA("ClickDetector") then
    fireclickdetector(target)
end
end)`);
                    break;
                case "fireProximityPrompt":
                    fsBridge.executeOnClients([pid], `pcall(function()
${luaResolve("target", treePath || path)}
if target:IsA("ProximityPrompt") then
    fireproximityprompt(target)
end
end)`);
                    break;
                case "refreshNil":
                    // Force reload nil instances
                    setTree(prev => {
                        const u = (nodes: TreeNode[]): TreeNode[] =>
                            nodes.map(n => {
                                if (n.path === "nil") return { ...n, loaded: false, expanded: false, children: undefined };
                                if (n.children) return { ...n, children: u(n.children) };
                                return n;
                            });
                        return u(prev);
                    });
                    // Re-expand to trigger fetch
                    setTimeout(() => toggleExpand("nil"), 100);
                    break;
                case "hideNil":
                    // Clear nil instances from tree
                    setTree(prev => {
                        const u = (nodes: TreeNode[]): TreeNode[] =>
                            nodes.map(n => {
                                if (n.path === "nil") return { ...n, loaded: false, expanded: false, children: undefined };
                                if (n.children) return { ...n, children: u(n.children) };
                                return n;
                            });
                        return u(prev);
                    });
                    break;
                case "clearSearchJumpTo": {
                    document.body.style.background = "red"; setTimeout(() => document.body.style.background = "", 2000);
                    setSearchQuery("");
                    console.log("[DEX-JUMP] clearSearchJumpTo for path:", path);
                    // Inline async expansion - no useEffect/state needed
                    (async () => {
                        const segs = path.split(".");
                        for (let i = 2; i < segs.length; i++) {
                            const ancestorPath = segs.slice(0, i).join(".");
                            console.log("[DEX-JUMP] Expanding:", ancestorPath);
                            // Create one-shot request
                            const reqId = "jump_" + Date.now() + "_" + i;
                            const result = await new Promise<any>((resolve) => {
                                const timeout = setTimeout(() => { resolve(null); console.log("[DEX-JUMP] TIMEOUT for", ancestorPath); }, 5000);
                                const handler = (data: any) => {
                                    if (data?.requestId === reqId) {
                                        clearTimeout(timeout);
                                        fsBridge.offDexData(handler);
                                        resolve(data);
                                    }
                                };
                                fsBridge.onDexData(handler);
                                fsBridge.dexRequest(pid, "dex_getChildren", { path: ancestorPath, requestId: reqId });
                            });
                            console.log("[DEX-JUMP] Result for", ancestorPath, ":", result ? (result.children?.length || 0) + " children" : "NULL");
                            if (result?.children) {
                                const nameCounts: Record<string, number> = {};
                                const children: TreeNode[] = result.children.map((c: any) => {
                                    const count = nameCounts[c.name] || 0;
                                    nameCounts[c.name] = count + 1;
                                    const childPath = count > 0 ? `${ancestorPath}.${c.name}[${count}]` : `${ancestorPath}.${c.name}`;
                                    return { name: c.name, className: c.className, path: childPath, hasChildren: c.hasChildren, loaded: false, expanded: false };
                                });
                                setTree(prev => {
                                    const u = (nodes: TreeNode[]): TreeNode[] =>
                                        nodes.map(n => {
                                            if (n.path === ancestorPath) return { ...n, loaded: true, expanded: true, children };
                                            if (n.children) return { ...n, children: u(n.children) };
                                            return n;
                                        });
                                    return u(prev);
                                });
                                await new Promise(r => setTimeout(r, 50));
                            }
                        }
                        console.log("[DEX-JUMP] All expanded, selecting:", path);
                        selectNode(path);
                        setTimeout(() => {
                            const el = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
                            console.log("[DEX-JUMP] Scroll target:", el ? "FOUND" : "NOT FOUND");
                            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                        }, 200);
                    })();
                    break;
                }
            }
        };
        return () => { delete (window as any).__dexContextMenuAction; };
    }, [selectChildrenOf, expandAllFrom, collapseAllFrom, insertObject, selectNode, pid, sendRequest]);

    /* ─── Keyboard shortcuts ─── */
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Don't intercept when typing in inputs
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
            if (!selectedPath || isRootNode(selectedPath)) return;

            const ctrl = e.ctrlKey || e.metaKey;

            if (ctrl && !e.shiftKey && e.key === "c") {
                e.preventDefault();
                dexClipboard.current = { path: selectedPath, isCut: false };
            } else if (ctrl && !e.shiftKey && e.key === "x") {
                e.preventDefault();
                dexClipboard.current = { path: selectedPath, isCut: true };
            } else if (ctrl && e.shiftKey && e.key === "V") {
                e.preventDefault();
                const clip = dexClipboard.current;
                if (!clip) return;
                fsBridge.executeOnClients([pid], `pcall(function()
${luaResolve("source", clip.path)}
${luaResolve("dest", selectedPath)}
local clone = source:Clone()
clone.Parent = dest
${clip.isCut ? "source:Destroy()" : ""}
end)`);
                if (clip.isCut) dexClipboard.current = null;
            } else if (ctrl && !e.shiftKey && e.key === "d") {
                e.preventDefault();
                const parentPath = selectedPath.split(".").slice(0, -1).join(".");
                if (!parentPath) return;
                fsBridge.executeOnClients([pid], `pcall(function()
${luaResolve("source", selectedPath)}
${luaResolve("parent", parentPath)}
local clone = source:Clone()
clone.Parent = parent
end)`);
            } else if (e.key === "F2") {
                e.preventDefault();
                const name = selectedPath.split(".").pop() ?? "";
                setEditingPath(selectedPath);
                setEditingName(name);
            } else if (e.key === "Delete") {
                e.preventDefault();
                fsBridge.executeOnClients([pid], `pcall(function()
${luaResolve("target", selectedPath)}
target:Destroy()
end)`);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [selectedPath, pid]);

    /* ─── Root check (services + nil) ─── */
    const isRootNode = (path: string) => path.split(".").length <= 2 && path.startsWith("game.") || path === "nil";

    /* ─── Drag & drop reparent ─── */
    const handleDragStart = useCallback((e: React.DragEvent, path: string, name: string) => {
        if (isRootNode(path)) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", path);
        e.dataTransfer.effectAllowed = "move";
        setDraggingPath(path);
        // Create a minimal drag image
        const ghost = document.createElement("div");
        ghost.textContent = name;
        ghost.style.cssText = "position:fixed;left:-999px;top:-999px;padding:2px 8px;background:#1a1a1e;border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:rgba(255,255,255,0.7);font-size:10px;white-space:nowrap;z-index:9999";
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        requestAnimationFrame(() => document.body.removeChild(ghost));
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, targetPath: string) => {
        e.preventDefault();
        if (!draggingPath || draggingPath === targetPath) {
            // Still handle auto-scroll even if not a valid drop target
            const container = treeScrollRef.current;
            if (container && draggingPath) {
                const rect = container.getBoundingClientRect();
                const y = e.clientY;
                const edgeZone = 80;
                const maxSpeed = 12;
                let speed = 0;
                if (y < rect.top + edgeZone) speed = -maxSpeed * (1 - (y - rect.top) / edgeZone);
                else if (y > rect.bottom - edgeZone) speed = maxSpeed * (1 - (rect.bottom - y) / edgeZone);
                if (dragScrollRAF.current) { cancelAnimationFrame(dragScrollRAF.current); dragScrollRAF.current = null; }
                if (speed !== 0) {
                    const scroll = () => { container.scrollTop += speed; dragScrollRAF.current = requestAnimationFrame(scroll); };
                    dragScrollRAF.current = requestAnimationFrame(scroll);
                }
            }
            return;
        }
        // Don't allow dropping onto a descendant of the dragged node
        if (targetPath.startsWith(draggingPath + ".")) return;
        e.dataTransfer.dropEffect = "move";
        setDropTargetPath(targetPath);
        // Auto-scroll near edges
        const container = treeScrollRef.current;
        if (container) {
            const rect = container.getBoundingClientRect();
            const y = e.clientY;
            const edgeZone = 80;
            const maxSpeed = 12;
            let speed = 0;
            if (y < rect.top + edgeZone) speed = -maxSpeed * (1 - (y - rect.top) / edgeZone);
            else if (y > rect.bottom - edgeZone) speed = maxSpeed * (1 - (rect.bottom - y) / edgeZone);
            if (dragScrollRAF.current) { cancelAnimationFrame(dragScrollRAF.current); dragScrollRAF.current = null; }
            if (speed !== 0) {
                const scroll = () => { container.scrollTop += speed; dragScrollRAF.current = requestAnimationFrame(scroll); };
                dragScrollRAF.current = requestAnimationFrame(scroll);
            }
        }
    }, [draggingPath]);

    const handleDrop = useCallback(async (e: React.DragEvent, targetPath: string) => {
        e.preventDefault();
        setDropTargetPath(null);
        setDraggingPath(null);
        if (dragScrollRAF.current) { cancelAnimationFrame(dragScrollRAF.current); dragScrollRAF.current = null; }
        const sourcePath = e.dataTransfer.getData("text/plain");
        if (!sourcePath || sourcePath === targetPath) return;
        if (targetPath.startsWith(sourcePath + ".")) return;
        const sourceParent = sourcePath.split(".").slice(0, -1).join(".");
        if (sourceParent === targetPath) return; // already a child
        const result = await sendRequest("dex_reparent", { sourcePath, destPath: targetPath });
        if (result?.success) {
            await reloadNode(targetPath);
        }
    }, [sendRequest, reloadNode]);

    const handleDragEnd = useCallback(() => {
        setDraggingPath(null);
        setDropTargetPath(null);
        if (dragScrollRAF.current) { cancelAnimationFrame(dragScrollRAF.current); dragScrollRAF.current = null; }
    }, []);

    /* ─── Render node ─── */
    const renderNode = (node: TreeNode, depth: number = 0) => {
        const isSel = selectedPaths.has(node.path);
        const isEditing = editingPath === node.path;
        const isDropTarget = dropTargetPath === node.path;
        const isDragged = draggingPath === node.path;
        return (
            <div key={node.path}>
                <div
                    className={cn(
                        "flex items-center gap-1 h-[20px] px-1 cursor-pointer transition-colors select-none",
                        isSel ? "bg-white/[0.12] ring-1 ring-inset ring-white/[0.08]" : "hover:bg-white/[0.04]",
                        isDropTarget && "bg-blue-500/20 ring-1 ring-inset ring-blue-400/40",
                        isDragged && "opacity-40"
                    )}
                    style={{ paddingLeft: depth * 14 + 4 }}
                    data-path={node.path}
                    draggable={!isRootNode(node.path) && !isEditing}
                    onDragStart={(e) => handleDragStart(e, node.path, node.name)}
                    onDragOver={(e) => handleDragOver(e, node.path)}
                    onDragLeave={() => { if (dropTargetPath === node.path) setDropTargetPath(null); }}
                    onDrop={(e) => handleDrop(e, node.path)}
                    onDragEnd={handleDragEnd}
                    onClick={(e) => {
                        if (isEditing) return;
                        if (pickingInstanceProp && selectedPath) {
                            console.log("[DEX] Picker: setting", pickingInstanceProp, "on", selectedPath, "to", node.path);
                            const oldParent = selectedPath.split(".").slice(0, -1).join(".");
                            const newParent = node.path;
                            sendSetProperty(selectedPath, pickingInstanceProp, node.path).then(() => {
                                if (oldParent) reloadNode(oldParent);
                                if (newParent && newParent !== oldParent) reloadNode(newParent);
                            });
                            setPickingInstanceProp(null);
                            return;
                        }
                        selectNode(node.path, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
                    }}
                    onDoubleClick={() => {
                        const isScript = node.className === 'LocalScript' || node.className === 'ModuleScript' || node.className === 'Script';
                        if (isScript) {
                            fsBridge.dexDoubleClick(node.path, node.name, node.className);
                        } else if (node.hasChildren) {
                            toggleExpand(node.path);
                        }
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        fsBridge.showDexContextMenu(e.clientX, e.clientY, node.path, node.name, isRootNode(node.path), !!dexClipboard.current, false, undefined, node.className);
                    }}
                >
                    {node.hasChildren || (node.expanded && node.children && node.children.length > 0) ? (
                        <button className="w-3.5 h-3.5 flex items-center justify-center shrink-0"
                            onClick={(e) => { e.stopPropagation(); toggleExpand(node.path); }}>
                            {node.expanded
                                ? <ChevronDown className="w-3 h-3 text-white/30" />
                                : <ChevronRight className="w-3 h-3 text-white/30" />}
                        </button>
                    ) : <span className="w-3.5 h-3.5 shrink-0" />}
                    {getIcon(node.className)}
                    {isEditing ? (
                        <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => { setEditingPath(null); setEditingName(""); }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); setEditingPath(null); setEditingName(""); }
                                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditingPath(null); setEditingName(""); }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 h-[16px] px-1 text-[10px] bg-white/[0.08] border border-white/[0.15] rounded text-white/80 outline-none"
                        />
                    ) : (
                        <span
                            className="text-[10px] text-white/70 truncate leading-none"
                            onClick={(e) => {
                                if (isSel) {
                                    e.stopPropagation();
                                    setEditingPath(node.path);
                                    setEditingName(node.name);
                                }
                            }}
                        >{stripIndex(node.name)}</span>
                    )}
                </div>
                {node.expanded && node.children && node.children.map((child, idx) => <div key={`${child.path}_${idx}`}>{renderNode(child, depth + 1)}</div>)}
            </div>
        );
    };

    /* ─── Render ─── */
    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0b] relative" onMouseDown={() => fsBridge.closeDexContextMenu()}>
            {/* Stop Viewing spinning border + appear keyframes */}
            <style>{`
                @keyframes dex-border-spin {
                    0% { --dex-spin-angle: 0deg; }
                    100% { --dex-spin-angle: 360deg; }
                }
                @keyframes dex-view-appear {
                    0% { opacity: 0; transform: translateY(-6px); max-height: 0; margin: 0; padding-top: 0; padding-bottom: 0; }
                    100% { opacity: 1; transform: translateY(0); max-height: 40px; }
                }
                @property --dex-spin-angle {
                    syntax: '<angle>';
                    initial-value: 0deg;
                    inherits: false;
                }
                .dex-stop-viewing-btn {
                    position: relative;
                    border: 1px solid transparent;
                    background-clip: padding-box;
                    animation: dex-view-appear 0.3s ease-out forwards;
                }
                .dex-stop-viewing-btn::before {
                    content: '';
                    position: absolute;
                    inset: -1px;
                    border-radius: inherit;
                    padding: 1px;
                    background: conic-gradient(from var(--dex-spin-angle), rgba(255,60,60,0.5), transparent 40%, transparent 60%, rgba(255,60,60,0.5));
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    animation: dex-border-spin 2s linear infinite;
                    pointer-events: none;
                }
                .dex-stop-viewing-btn:hover::before {
                    background: conic-gradient(from var(--dex-spin-angle), rgba(255,60,60,0.8), transparent 40%, transparent 60%, rgba(255,60,60,0.8));
                }
            `}</style>
            {/* No Signal overlay when client disconnects */}
            {disconnected && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0a0b]/90 backdrop-blur-sm">
                    <WifiOff className="w-8 h-8 text-white/10 mb-3" />
                    <span className="text-[12px] font-medium text-white/25">No Signal</span>
                    <span className="text-[10px] text-white/15 mt-1">Client disconnected or left the game</span>
                </div>
            )}
            {iconsLoading ? (
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 text-white/20 animate-spin" />
                </div>
            ) : (
                <>
                    {/* ═══ TREE (top) ═══ */}
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                        {/* Filter bar */}
                        <div className="px-1.5 py-1 border-b border-white/[0.06] shrink-0">
                            <div className="relative">
                                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Filter Workspace"
                                    className="w-full h-[20px] pl-5 pr-6 text-[10px] bg-white/[0.04] border border-white/[0.06] rounded text-white/70 placeholder:text-white/20 outline-none focus:border-white/[0.15] transition-colors"
                                />
                                {searchQuery && (
                                    <button onClick={() => setSearchQuery("")}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-white/[0.06]">
                                        <X className="w-2.5 h-2.5 text-white/30" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Tree content */}
                        <div className="flex-1 min-h-0 overflow-y-auto" ref={treeScrollRef}>
                            <div className="py-0.5">
                                {searchQuery.length >= 2 ? (
                                    searching ? (
                                        <div className="flex items-center justify-center py-4">
                                            <Loader2 className="w-3 h-3 text-white/20 animate-spin" />
                                        </div>
                                    ) : searchResults.length > 0 ? (() => {
                                        // Build a tree structure from flat search results
                                        type SearchRow = { key: string; path: string; copyPath: string; name: string; className: string; depth: number; isResult: boolean };
                                        const rows: SearchRow[] = [];
                                        const addedPrefixes = new Set<string>();
                                        // Walk loaded tree to find className by path (fallback)
                                        const classFromTree = (targetPath: string): string => {
                                            const walk = (nodes: TreeNode[]): string => {
                                                for (const n of nodes) {
                                                    if (n.path === targetPath) return n.className;
                                                    if (targetPath.startsWith(n.path + ".") && n.children) {
                                                        const found = walk(n.children);
                                                        if (found) return found;
                                                    }
                                                }
                                                return "";
                                            };
                                            return walk(tree);
                                        };
                                        searchResults.forEach((r, idx) => {
                                            const segments = r.path.split(".");
                                            const pc = (r as any).parentClasses as string[] || [];
                                            // Add ancestor nodes using parentClasses from this result
                                            // parentClasses[0] = service className, [1] = first child, etc.
                                            for (let d = 1; d < segments.length - 1; d++) {
                                                const prefix = segments.slice(0, d + 1).join(".");
                                                if (!addedPrefixes.has(prefix)) {
                                                    addedPrefixes.add(prefix);
                                                    const segName = stripIndex(segments[d]);
                                                    // d-1 maps to parentClasses index (d=1 → pc[0]=service, d=2 → pc[1]=first child)
                                                    const ancClass = (pc.length > d - 1 ? pc[d - 1] : "") || searchPathClasses.current[prefix] || classFromTree(prefix) || (d === 1 ? segName : "");
                                                    rows.push({ key: `anc_${prefix}`, path: prefix, copyPath: formatCopyPath(prefix, username), name: segName, className: ancClass, depth: d - 1, isResult: false });
                                                }
                                            }
                                            // Add actual result with unique key
                                            const uniqueKey = `${r.path}__${idx}`;
                                            rows.push({ key: uniqueKey, path: r.path, copyPath: formatCopyPath(r.path, username), name: stripIndex(r.name), className: r.className, depth: segments.length - 2, isResult: true });
                                        });

                                        // Fix copy paths for duplicate results that share the same formatted path
                                        // (e.g. multiple "Model" under same parent both format to game:GetService("Workspace").map.Model)
                                        const resultRows = rows.filter(r => r.isResult);
                                        const copyPathCounts = new Map<string, number>();
                                        for (const r of resultRows) {
                                            copyPathCounts.set(r.copyPath, (copyPathCounts.get(r.copyPath) || 0) + 1);
                                        }
                                        // For duplicate copy paths, assign :GetChildren()[N]
                                        const copyPathIndices = new Map<string, number>();
                                        for (const r of resultRows) {
                                            const count = copyPathCounts.get(r.copyPath) || 1;
                                            if (count > 1) {
                                                const idx = (copyPathIndices.get(r.copyPath) || 0) + 1;
                                                copyPathIndices.set(r.copyPath, idx);
                                                // Get parent copy path and append :GetChildren()[N]
                                                const lastDot = r.copyPath.lastIndexOf(".");
                                                if (lastDot > 0) {
                                                    const parentPart = r.copyPath.substring(0, lastDot);
                                                    r.copyPath = `${parentPart}:GetChildren()[${idx}]`;
                                                }
                                            }
                                        }

                                        // Filter out rows under collapsed ancestors
                                        const collapsedPrefixes = collapsedSearchPrefixes.current;
                                        const visibleRows = rows.filter(row => {
                                            for (const cp of collapsedPrefixes) {
                                                if (row.path.startsWith(cp + ".") && row.path !== cp) return false;
                                            }
                                            return true;
                                        });

                                        return visibleRows.map(row => row.isResult ? (
                                            <div key={row.key}
                                                className={cn(
                                                    "flex items-center gap-1 h-[20px] px-1 cursor-pointer transition-colors select-none",
                                                    selectedSearchKey.current === row.key ? "bg-white/[0.12] ring-1 ring-inset ring-white/[0.08]" : "hover:bg-white/[0.04]"
                                                )}
                                                style={{ paddingLeft: row.depth * 14 + 4 }}
                                                onClick={() => {
                                                    selectedSearchKey.current = row.key;
                                                    selectNode(row.path);
                                                }}
                                                onDoubleClick={() => {
                                                    const isScript = row.className === 'LocalScript' || row.className === 'ModuleScript' || row.className === 'Script';
                                                    if (isScript) {
                                                        fsBridge.dexDoubleClick(row.path, row.name, row.className);
                                                    }
                                                }}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    // Pass copyPath for the copy action, raw tree path for navigation (jump-to, parent)
                                                    fsBridge.showDexContextMenu(e.clientX, e.clientY, row.copyPath, row.name, isRootNode(row.path), !!dexClipboard.current, true, row.path, row.className);
                                                }}
                                            >
                                                {getIcon(row.className)}
                                                <span className="text-[10px] text-white/70 truncate">{row.name}</span>
                                                <span className="text-[8px] text-white/20 ml-auto shrink-0">{row.className}</span>
                                            </div>
                                        ) : (
                                            <div key={row.key}
                                                className="flex items-center gap-1 h-[18px] px-1 select-none cursor-pointer hover:bg-white/[0.04] transition-colors"
                                                style={{ paddingLeft: row.depth * 14 + 4 }}
                                                onClick={() => {
                                                    const set = collapsedSearchPrefixes.current;
                                                    if (set.has(row.path)) {
                                                        set.delete(row.path);
                                                    } else {
                                                        set.add(row.path);
                                                    }
                                                    forceSearchRerender(c => c + 1);
                                                }}
                                            >
                                                <ChevronDown className={cn("w-2.5 h-2.5 text-white/30 transition-transform", collapsedPrefixes.has(row.path) && "-rotate-90")} />
                                                {getIcon(row.className)}
                                                <span className="text-[9px] text-white/25 truncate">{row.name}</span>
                                            </div>
                                        ));
                                    })() : (
                                        <p className="text-center py-6 text-[10px] text-white/20">No results</p>
                                    )
                                ) : tree.length === 0 ? (
                                    /* ═══ NO SIGNAL STATE ═══ */
                                    <div className="flex flex-col items-center justify-center h-full select-none relative overflow-hidden">
                                        {/* Inline keyframes */}
                                        <style>{`
                                            @keyframes dex-pulse-ring {
                                                0% { transform: scale(0.5); opacity: 0.5; }
                                                100% { transform: scale(2.5); opacity: 0; }
                                            }
                                            @keyframes dex-rotate-scan {
                                                0% { transform: rotate(0deg); }
                                                100% { transform: rotate(360deg); }
                                            }
                                            @keyframes dex-breathe {
                                                0%, 100% { opacity: 0.03; }
                                                50% { opacity: 0.08; }
                                            }
                                            @keyframes dex-float {
                                                0%, 100% { transform: translateY(0px); }
                                                50% { transform: translateY(-4px); }
                                            }
                                        `}</style>

                                        {/* Background breathing gradient */}
                                        <div className="absolute inset-0" style={{
                                            background: "radial-gradient(circle at 50% 45%, rgba(255,60,60,0.06) 0%, transparent 60%)",
                                            animation: "dex-breathe 4s ease-in-out infinite"
                                        }} />

                                        {/* Pulse rings container */}
                                        <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
                                            {/* Pulse rings */}
                                            {[0, 1, 2].map(i => (
                                                <div key={i} className="absolute rounded-full border border-red-500/20" style={{
                                                    width: 60, height: 60,
                                                    left: "50%", top: "50%",
                                                    marginLeft: -30, marginTop: -30,
                                                    animation: `dex-pulse-ring 3s ease-out ${i * 0.8}s infinite`
                                                }} />
                                            ))}

                                            {/* Rotating scan ring */}
                                            <div className="absolute rounded-full" style={{
                                                width: 70, height: 70,
                                                left: "50%", top: "50%",
                                                marginLeft: -35, marginTop: -35,
                                                border: "1px dashed rgba(255,80,80,0.12)",
                                                animation: "dex-rotate-scan 8s linear infinite"
                                            }} />

                                            {/* Signal icon */}
                                            <div style={{ animation: "dex-float 3s ease-in-out infinite" }}>
                                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,80,80,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                                    {/* Signal bars */}
                                                    <path d="M2 20h.01" />
                                                    <path d="M7 20v-4" opacity="0.3" />
                                                    <path d="M12 20v-8" opacity="0.2" />
                                                    <path d="M17 20v-12" opacity="0.15" />
                                                    {/* Slash through */}
                                                    <line x1="3" y1="3" x2="21" y2="21" stroke="rgba(255,60,60,0.6)" strokeWidth="2" />
                                                </svg>
                                            </div>
                                        </div>

                                        {/* Text */}
                                        <div className="flex flex-col items-center gap-1.5 mt-1 relative z-10">
                                            <span className="text-[11px] font-semibold tracking-[0.2em] uppercase" style={{
                                                color: "rgba(255,80,80,0.45)",
                                                textShadow: "0 0 12px rgba(255,60,60,0.15)"
                                            }}>No Signal</span>
                                            <span className="text-[9px] text-white/15">Searching for connection...</span>
                                        </div>
                                    </div>
                                ) : (
                                    tree.map(node => renderNode(node))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ═══ STOP VIEWING BUTTON ═══ */}
                    {viewingObject && (
                        <button
                            onClick={() => {
                                fsBridge.executeOnClients([pid], `pcall(function()
local plr = game:GetService("Players").LocalPlayer
if plr and plr.Character then
    workspace.CurrentCamera.CameraSubject = plr.Character:FindFirstChildWhichIsA("Humanoid") or plr.Character
end
end)`);
                                setViewingObject(null);
                            }}
                            className="dex-stop-viewing-btn flex items-center justify-center gap-1 shrink-0 mx-1.5 my-1 px-1.5 py-[2px] rounded text-[9px] font-medium text-red-400/80 bg-white/[0.03] cursor-pointer hover:text-red-300 hover:bg-white/[0.06] transition-colors"
                        >
                            <Camera className="w-2.5 h-2.5" />
                            Stop Viewing
                        </button>
                    )}

                    {/* ═══ RESIZE HANDLE ═══ */}
                    <div
                        className="h-[3px] bg-white/[0.06] cursor-row-resize hover:bg-white/[0.15] transition-colors shrink-0"
                        onMouseDown={handleResizeStart}
                    />

                    {/* ═══ PROPERTIES (bottom) ═══ */}
                    <div className="flex flex-col shrink-0 overflow-hidden" style={{ height: propsPanelHeight, maxHeight: '50%' }}>
                        {/* Properties header */}
                        <div className="flex items-center h-[20px] px-2 border-b border-white/[0.06] shrink-0 gap-1">
                            <span className="text-[9px] font-semibold text-white/40 uppercase tracking-wider">Properties</span>
                            <div className="flex-1" />
                            <div className="group relative">
                                <button
                                    onClick={() => setLiveProperties(!liveProperties)}
                                    className={cn("w-4 h-4 flex items-center justify-center rounded-sm transition-colors",
                                        liveProperties ? "text-emerald-400" : "text-white/20 hover:text-white/40")}>
                                    <Activity className="w-2.5 h-2.5" />
                                </button>
                                <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 origin-top z-50">
                                    <div className="relative bg-[#1a1a1e] border border-white/[0.1] rounded px-1.5 py-0.5 whitespace-nowrap shadow-lg">
                                        <div className="absolute left-1/2 -translate-x-1/2 -top-[4px] w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[4px] border-b-white/[0.1]" />
                                        <span className="text-[8px] text-white/60">Live Properties</span>
                                    </div>
                                </div>
                            </div>
                            <div className="group relative">
                                <button
                                    onClick={() => setShowHidden(!showHidden)}
                                    className={cn("w-4 h-4 flex items-center justify-center rounded-sm transition-colors",
                                        showHidden ? "text-white/60" : "text-white/20 hover:text-white/40")}>
                                    {showHidden ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                                </button>
                                <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 origin-top z-50">
                                    <div className="relative bg-[#1a1a1e] border border-white/[0.1] rounded px-1.5 py-0.5 whitespace-nowrap shadow-lg">
                                        <div className="absolute left-1/2 -translate-x-1/2 -top-[4px] w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[4px] border-b-white/[0.1]" />
                                        <span className="text-[8px] text-white/60">Show Hidden</span>
                                    </div>
                                </div>
                            </div>
                            <div className="group relative">
                                <button
                                    onClick={() => setShowDeprecated(!showDeprecated)}
                                    className={cn("w-4 h-4 flex items-center justify-center rounded-sm transition-colors",
                                        showDeprecated ? "text-white/60" : "text-white/20 hover:text-white/40")}>
                                    <RotateCcw className="w-2.5 h-2.5" />
                                </button>
                                <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 origin-top z-50">
                                    <div className="relative bg-[#1a1a1e] border border-white/[0.1] rounded px-1.5 py-0.5 whitespace-nowrap shadow-lg">
                                        <div className="absolute left-1/2 -translate-x-1/2 -top-[4px] w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[4px] border-b-white/[0.1]" />
                                        <span className="text-[8px] text-white/60">Show Deprecated</span>
                                    </div>
                                </div>
                            </div>
                            <div className="group relative">
                                <button
                                    onClick={() => {
                                        const newVal = !clickToSelect;
                                        setClickToSelect(newVal);
                                        if (newVal) {
                                            // Set up onDexData listener for click responses
                                            const handler = (_: any, data: any) => {
                                                if (data?.type === "dex_clickSelect" && data?.targetPath) {
                                                    // targetPath includes [N] dedup indices from Lua, e.g. "Workspace.Model.Part[1]"
                                                    const rawPath = data.targetPath.replace(/^game\./, "");
                                                    const segs = rawPath.split(".");
                                                    setSearchQuery("");
                                                    // Kick off step-by-step expansion via useEffect (fresh refs at each step)
                                                    setClickSelectTask({ segs, step: 0, path: "game" });
                                                }
                                            };
                                            (window as any).__cpts_handler = handler;
                                            fsBridge.onDexData(handler);
                                            // Send Lua to connect Mouse.Button1Down — builds unique path with [N] dedup
                                            fsBridge.executeOnClients([pid], `pcall(function()
local plr = game:GetService("Players").LocalPlayer
local mouse = plr:GetMouse()
local HttpService = game:GetService("HttpService")
local ws = getgenv().__3itx_ws
if getgenv().__cpts_conn then pcall(function() getgenv().__cpts_conn:Disconnect() end) end
-- Build a unique path with [N] indices for same-named siblings
local function getUniquePath(inst)
    local parts = {}
    local cur = inst
    while cur and cur ~= game do
        local parent = cur.Parent
        if parent then
            local name = cur.Name
            local idx = 0
            for _, sib in ipairs(parent:GetChildren()) do
                if sib == cur then break end
                if sib.Name == name then idx = idx + 1 end
            end
            if idx > 0 then
                table.insert(parts, 1, name .. "[" .. idx .. "]")
            else
                table.insert(parts, 1, name)
            end
        end
        cur = cur.Parent
    end
    return table.concat(parts, ".")
end
getgenv().__cpts_conn = mouse.Button1Down:Connect(function()
    pcall(function()
        local target = mouse.Target
        if target and ws then
            ws:Send(HttpService:JSONEncode({type="dex_clickSelect",targetPath=getUniquePath(target)}))
        end
    end)
end)
end)`);
                                        } else {
                                            // Disconnect
                                            if ((window as any).__cpts_handler) {
                                                fsBridge.offDexData((window as any).__cpts_handler);
                                                delete (window as any).__cpts_handler;
                                            }
                                            fsBridge.executeOnClients([pid], `pcall(function()
if getgenv().__cpts_conn then getgenv().__cpts_conn:Disconnect() getgenv().__cpts_conn = nil end
end)`);
                                        }
                                    }}
                                    className={cn("w-4 h-4 flex items-center justify-center rounded-sm transition-colors",
                                        clickToSelect ? "text-sky-400" : "text-white/20 hover:text-white/40")}>
                                    <Crosshair className="w-2.5 h-2.5" />
                                </button>
                                <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 origin-top z-50">
                                    <div className="relative bg-[#1a1a1e] border border-white/[0.1] rounded px-1.5 py-0.5 whitespace-nowrap shadow-lg">
                                        <div className="absolute left-1/2 -translate-x-1/2 -top-[4px] w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[4px] border-b-white/[0.1]" />
                                        <span className="text-[8px] text-white/60">Click Part to Select</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Search props */}
                        <div className="px-1.5 py-1 border-b border-white/[0.06] shrink-0">
                            <div className="relative">
                                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20" />
                                <input type="text" value={propSearch} onChange={(e) => setPropSearch(e.target.value)}
                                    placeholder="Search Properties"
                                    className="w-full h-[20px] pl-5 pr-2 text-[10px] bg-white/[0.04] border border-white/[0.06] rounded text-white/70 placeholder:text-white/20 outline-none focus:border-white/[0.15] transition-colors" />
                            </div>
                        </div>

                        {/* Props grid */}
                        <div className="flex-1 min-h-0 overflow-y-auto">
                            {!selectedPath ? (
                                <p className="text-center py-6 text-[10px] text-white/20">Select an instance</p>
                            ) : propsLoading ? (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="w-3 h-3 text-white/20 animate-spin" />
                                </div>
                            ) : (() => {
                                // Group properties by category
                                const groups: Record<string, PropertyInfo[]> = {};
                                filteredProps.forEach(p => {
                                    const cat = p.category || "Other";
                                    if (!groups[cat]) groups[cat] = [];
                                    groups[cat].push(p);
                                });
                                const categoryOrder = Object.keys(groups).sort();
                                const toggleCategory = (cat: string) => {
                                    setCollapsedCategories(prev => {
                                        const next = new Set(prev);
                                        if (next.has(cat)) next.delete(cat);
                                        else next.add(cat);
                                        return next;
                                    });
                                };

                                if (categoryOrder.length === 0) {
                                    return <p className="text-center py-4 text-[10px] text-white/20">No properties</p>;
                                }

                                return (
                                    <div>
                                        {categoryOrder.map(cat => {
                                            const props = groups[cat];
                                            const isCollapsed = collapsedCategories.has(cat);
                                            return (
                                                <div key={cat}>
                                                    {/* Category header */}
                                                    <button
                                                        onClick={() => toggleCategory(cat)}
                                                        className="flex items-center w-full h-[18px] px-1.5 bg-white/[0.03] border-b border-white/[0.06] hover:bg-white/[0.06] transition-colors cursor-pointer"
                                                    >
                                                        {isCollapsed
                                                            ? <ChevronRight className="w-2.5 h-2.5 text-white/30 shrink-0" />
                                                            : <ChevronDown className="w-2.5 h-2.5 text-white/30 shrink-0" />
                                                        }
                                                        <span className="text-[9px] font-semibold text-white/50 ml-1 uppercase tracking-wider">{cat}</span>
                                                        <span className="text-[8px] text-white/20 ml-auto">{props.length}</span>
                                                    </button>
                                                    {/* Properties in this category */}
                                                    {!isCollapsed && props.map((prop, i) => {
                                                        const isEditing = editingProp?.name === prop.name;
                                                        const isReadOnly = prop.readOnly;
                                                        const compound = parseCompound(prop.valueType || prop.type, prop.value);
                                                        const cframeParts = (prop.valueType === "CFrame" || prop.type === "CFrame") ? parseCFrame(prop.value) : null;
                                                        const isExpandable = !!compound || !!cframeParts;
                                                        const isExpanded = expandedProps.has(prop.name);
                                                        const isInstance = isInstanceProp(prop);

                                                        const toggleExpand = () => {
                                                            setExpandedProps(prev => {
                                                                const next = new Set(prev);
                                                                if (next.has(prop.name)) next.delete(prop.name);
                                                                else next.add(prop.name);
                                                                return next;
                                                            });
                                                        };

                                                        return (
                                                            <div key={`${cat}-${prop.name}`}>
                                                                {/* Main property row */}
                                                                <div
                                                                    className={cn("flex items-center h-[19px] border-b border-white/[0.04] relative",
                                                                        i % 2 === 0 ? "bg-transparent" : "bg-white/[0.02]",
                                                                        isEditing && prop.enumOptions && "overflow-visible")}
                                                                >
                                                                    <span className={cn("text-[10px] w-[45%] px-1.5 truncate shrink-0 border-r border-white/[0.04] flex items-center gap-0.5",
                                                                        prop.hidden ? "text-purple-400/50" : isReadOnly ? "text-white/30" : "text-white/50")}>
                                                                        {isExpandable ? (
                                                                            <button onClick={toggleExpand} className="shrink-0 opacity-40 hover:opacity-70 transition-opacity">
                                                                                {isExpanded
                                                                                    ? <ChevronDown className="w-2.5 h-2.5" />
                                                                                    : <ChevronRight className="w-2.5 h-2.5" />
                                                                                }
                                                                            </button>
                                                                        ) : null}
                                                                        <span className="truncate">{prop.name}</span>
                                                                    </span>
                                                                    <div
                                                                        className={cn(
                                                                            "text-[10px] flex-1 px-1.5 flex items-center min-w-0 overflow-visible",
                                                                            !isReadOnly && !isEditing && prop.type !== "boolean" && !(prop.enumOptions && prop.enumOptions.length > 0) && !isExpandable && "cursor-pointer hover:bg-white/[0.03]"
                                                                        )}
                                                                        onClick={() => {
                                                                            if (isReadOnly || isEditing) return;
                                                                            // Instance property — enter picker mode
                                                                            if (isInstance) {
                                                                                setPickingInstanceProp(prop.name);
                                                                                return;
                                                                            }
                                                                            // Plain value types
                                                                            if (prop.type !== "boolean" && !(prop.enumOptions && prop.enumOptions.length > 0) && !isExpandable) {
                                                                                setEditingProp({ name: prop.name, value: prop.value });
                                                                            }
                                                                        }}
                                                                    >
                                                                        {prop.type === "boolean" ? (
                                                                            <label
                                                                                className={cn("flex items-center gap-1.5 cursor-pointer", isReadOnly && "opacity-50 pointer-events-none")}
                                                                                onClick={() => {
                                                                                    if (!isReadOnly && selectedPath) {
                                                                                        sendSetProperty(selectedPath, prop.name, prop.value === "true" ? "false" : "true");
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <div className={cn(
                                                                                    "w-3 h-3 rounded-[2px] border flex items-center justify-center shrink-0 transition-colors",
                                                                                    prop.value === "true"
                                                                                        ? "bg-[#3b3b3b] border-white/20"
                                                                                        : "bg-[#2a2a2a] border-white/10"
                                                                                )}>
                                                                                    {prop.value === "true" && (
                                                                                        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                                                                                            <path d="M2 6l3 3 5-5" />
                                                                                        </svg>
                                                                                    )}
                                                                                </div>
                                                                            </label>
                                                                        ) : isInstance ? (
                                                                            /* Instance reference — click cell to enter picker */
                                                                            pickingInstanceProp === prop.name ? (
                                                                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                                                                    <span className="text-white/60 text-[10px] italic animate-pulse">Click an instance in the tree...</span>
                                                                                    <button
                                                                                        className="shrink-0 w-3 h-3 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors"
                                                                                        onClick={(e) => { e.stopPropagation(); setPickingInstanceProp(null); }}
                                                                                        title="Cancel"
                                                                                    >
                                                                                        <X className="w-2.5 h-2.5" />
                                                                                    </button>
                                                                                </div>
                                                                            ) : (
                                                                                <span
                                                                                    className={cn(
                                                                                        "truncate",
                                                                                        prop.value && prop.value !== "" && prop.value !== "nil"
                                                                                            ? "text-white/50"
                                                                                            : "text-white/25 italic"
                                                                                    )}
                                                                                >
                                                                                    {prop.value && prop.value !== "" && prop.value !== "nil" ? prop.value.split(".").pop() : "nil"}
                                                                                </span>
                                                                            )
                                                                        ) : prop.enumOptions && prop.enumOptions.length > 0 ? (
                                                                            <div className="relative flex-1 min-w-0">
                                                                                <div
                                                                                    className={cn(
                                                                                        "flex items-center justify-between gap-0.5 truncate",
                                                                                        isReadOnly ? "text-white/25" : "text-white/40 cursor-pointer hover:text-white/60"
                                                                                    )}
                                                                                    onClick={(e) => {
                                                                                        if (isReadOnly) return;
                                                                                        if (isEditing) {
                                                                                            setEditingProp(null);
                                                                                            setDropdownPos(null);
                                                                                        } else {
                                                                                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                                                            setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 120) });
                                                                                            setEditingProp({ name: prop.name, value: prop.value });
                                                                                        }
                                                                                    }}
                                                                                >
                                                                                    <span className="truncate">{prop.value}</span>
                                                                                    {!isReadOnly && (
                                                                                        <svg viewBox="0 0 10 6" className="w-2 h-1.5 shrink-0 opacity-40">
                                                                                            <path d="M1 1l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.5" />
                                                                                        </svg>
                                                                                    )}
                                                                                </div>
                                                                                {isEditing && dropdownPos && (
                                                                                    <div
                                                                                        data-dropdown
                                                                                        className="fixed z-[100] max-h-[150px] overflow-y-auto border border-white/[0.06] rounded-sm py-0.5"
                                                                                        style={{
                                                                                            top: dropdownPos.top,
                                                                                            left: dropdownPos.left,
                                                                                            minWidth: dropdownPos.width,
                                                                                            background: "#1a1a24",
                                                                                            boxShadow: "0 4px 12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
                                                                                        }}
                                                                                    >
                                                                                        {prop.enumOptions.map(opt => (
                                                                                            <div
                                                                                                key={opt}
                                                                                                className={cn(
                                                                                                    "px-2 py-[3px] text-[10px] cursor-pointer transition-colors",
                                                                                                    opt === prop.value
                                                                                                        ? "bg-white/[0.08] text-white/90"
                                                                                                        : "text-white/50 hover:bg-white/[0.05] hover:text-white/70"
                                                                                                )}
                                                                                                onClick={() => {
                                                                                                    if (selectedPath && opt !== prop.value) {
                                                                                                        sendSetProperty(selectedPath, prop.name, opt);
                                                                                                    }
                                                                                                    setEditingProp(null);
                                                                                                    setDropdownPos(null);
                                                                                                }}
                                                                                            >
                                                                                                {opt}
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        ) : isEditing ? (
                                                                            <div className="flex items-center gap-0.5 flex-1 min-w-0">
                                                                                <input
                                                                                    autoFocus
                                                                                    defaultValue={editingProp.value}
                                                                                    className="flex-1 min-w-0 h-[15px] px-1 text-[10px] bg-white/[0.08] border border-white/[0.15] rounded-sm text-white/80 outline-none"
                                                                                    onBlur={(e) => {
                                                                                        if (selectedPath && e.target.value !== prop.value) {
                                                                                            sendSetProperty(selectedPath, prop.name, e.target.value);
                                                                                        }
                                                                                        setEditingProp(null);
                                                                                    }}
                                                                                    onKeyDown={(e) => {
                                                                                        if (e.key === "Enter") {
                                                                                            e.preventDefault(); e.stopPropagation();
                                                                                            (e.target as HTMLInputElement).blur();
                                                                                        }
                                                                                        if (e.key === "Escape") {
                                                                                            e.preventDefault(); e.stopPropagation();
                                                                                            setEditingProp(null);
                                                                                        }
                                                                                    }}
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                />
                                                                                <button
                                                                                    className="shrink-0 w-3 h-3 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors"
                                                                                    onMouseDown={(e) => { e.preventDefault(); setEditingProp(null); }}
                                                                                    title="Cancel"
                                                                                >
                                                                                    <X className="w-2.5 h-2.5" />
                                                                                </button>
                                                                            </div>
                                                                        ) : (() => {
                                                                            // Color3/BrickColor detection
                                                                            const isBrickColor = prop.type === "BrickColor" || prop.valueType === "BrickColor";
                                                                            const isColor3 = prop.type === "Color3" || prop.valueType === "Color3";
                                                                            let colorR255 = 0, colorG255 = 0, colorB255 = 0;
                                                                            let validColor = false;

                                                                            if (isColor3 && prop.value) {
                                                                                // Color3: value is "r, g, b" as 0-1 floats
                                                                                const parts = prop.value.split(",").map((s: string) => parseFloat(s.trim()));
                                                                                if (parts.length >= 3 && parts.every((n: number) => !isNaN(n))) {
                                                                                    colorR255 = Math.round(parts[0] * 255);
                                                                                    colorG255 = Math.round(parts[1] * 255);
                                                                                    colorB255 = Math.round(parts[2] * 255);
                                                                                    validColor = true;
                                                                                }
                                                                            } else if (isBrickColor && prop.value) {
                                                                                // BrickColor: value is a named color
                                                                                const bc = BRICK_COLORS[prop.value];
                                                                                if (bc) {
                                                                                    [colorR255, colorG255, colorB255] = bc;
                                                                                    validColor = true;
                                                                                }
                                                                            }

                                                                            if (validColor) {
                                                                                const toHex2 = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
                                                                                const hexColor = `#${toHex2(colorR255)}${toHex2(colorG255)}${toHex2(colorB255)}`;
                                                                                const pickerOpen = colorPickerProp?.name === prop.name;
                                                                                return (
                                                                                    <div className="flex items-center gap-1.5 flex-1 min-w-0 relative">
                                                                                        <div
                                                                                            className={cn("w-3 h-3 rounded-[2px] border border-white/20 shrink-0", !isReadOnly && "cursor-pointer hover:border-white/40 transition-colors")}
                                                                                            style={{ backgroundColor: hexColor }}
                                                                                            onClick={(e) => {
                                                                                                if (isReadOnly) return;
                                                                                                e.stopPropagation();
                                                                                                if (pickerOpen) {
                                                                                                    setColorPickerProp(null);
                                                                                                } else {
                                                                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                                                                    setColorPickerProp({
                                                                                                        name: prop.name,
                                                                                                        r: colorR255,
                                                                                                        g: colorG255,
                                                                                                        b: colorB255,
                                                                                                        posX: rect.left + rect.width / 2,
                                                                                                        posY: rect.bottom + 4,
                                                                                                        isBrickColor,
                                                                                                    });
                                                                                                }
                                                                                            }}
                                                                                            title={isReadOnly ? hexColor : "Click to pick color"}
                                                                                        />
                                                                                        <span className={cn("truncate", isReadOnly ? "text-white/25" : "text-white/40")}>
                                                                                            {prop.value}
                                                                                        </span>
                                                                                        {/* Custom dark color picker popup */}
                                                                                        {pickerOpen && colorPickerProp && (() => {
                                                                                            // Clamp popup to viewport
                                                                                            const popupH = colorPickerProp.isBrickColor ? 230 : 220;
                                                                                            const popupW = 200;
                                                                                            const clampedTop = Math.min(colorPickerProp.posY, window.innerHeight - popupH - 8);
                                                                                            const clampedLeft = Math.max(4, Math.min(colorPickerProp.posX - popupW / 2, window.innerWidth - popupW - 4));

                                                                                            if (colorPickerProp.isBrickColor) {
                                                                                                // BrickColor preset grid
                                                                                                return (
                                                                                                    <div
                                                                                                        data-colorpicker
                                                                                                        className="fixed z-[200] rounded-md border border-white/[0.08] shadow-xl"
                                                                                                        style={{
                                                                                                            background: "#1a1a24",
                                                                                                            boxShadow: "0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
                                                                                                            width: popupW,
                                                                                                            left: clampedLeft,
                                                                                                            top: clampedTop,
                                                                                                        }}
                                                                                                        onClick={(e) => e.stopPropagation()}
                                                                                                    >
                                                                                                        <div className="p-2">
                                                                                                            <span className="text-[8px] text-white/30 uppercase tracking-wider block mb-1.5">BrickColor — {prop.value}</span>
                                                                                                            <div className="grid gap-[2px] max-h-[190px] overflow-y-auto" style={{ gridTemplateColumns: "repeat(10, 1fr)" }}>
                                                                                                                {Object.entries(BRICK_COLORS).map(([bcName, [br, bg, bb]]) => (
                                                                                                                    <div
                                                                                                                        key={bcName}
                                                                                                                        className={cn(
                                                                                                                            "w-full aspect-square rounded-[2px] cursor-pointer border transition-all hover:scale-110 hover:z-10",
                                                                                                                            prop.value === bcName ? "border-white ring-1 ring-white/40" : "border-transparent hover:border-white/40"
                                                                                                                        )}
                                                                                                                        style={{ backgroundColor: `rgb(${br},${bg},${bb})` }}
                                                                                                                        title={bcName}
                                                                                                                        onClick={() => {
                                                                                                                            if (selectedPath) {
                                                                                                                                sendSetProperty(selectedPath, prop.name, bcName);
                                                                                                                            }
                                                                                                                            setColorPickerProp(null);
                                                                                                                        }}
                                                                                                                    />
                                                                                                                ))}
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                );
                                                                                            }

                                                                                            // Color3 HSV picker
                                                                                            const cpR = colorPickerProp.r, cpG = colorPickerProp.g, cpB = colorPickerProp.b;
                                                                                            const rr = cpR / 255, gg = cpG / 255, bb = cpB / 255;
                                                                                            const cmax = Math.max(rr, gg, bb), cmin = Math.min(rr, gg, bb), delta = cmax - cmin;
                                                                                            let hue = 0;
                                                                                            if (delta > 0) {
                                                                                                if (cmax === rr) hue = ((gg - bb) / delta) % 6;
                                                                                                else if (cmax === gg) hue = (bb - rr) / delta + 2;
                                                                                                else hue = (rr - gg) / delta + 4;
                                                                                                hue = Math.round(hue * 60);
                                                                                                if (hue < 0) hue += 360;
                                                                                            }
                                                                                            const sat = cmax === 0 ? 0 : delta / cmax;
                                                                                            const val = cmax;

                                                                                            const hsvToRgb = (h: number, s: number, v: number) => {
                                                                                                const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
                                                                                                let rp = 0, gp = 0, bp = 0;
                                                                                                if (h < 60) { rp = c; gp = x; }
                                                                                                else if (h < 120) { rp = x; gp = c; }
                                                                                                else if (h < 180) { gp = c; bp = x; }
                                                                                                else if (h < 240) { gp = x; bp = c; }
                                                                                                else if (h < 300) { rp = x; bp = c; }
                                                                                                else { rp = c; bp = x; }
                                                                                                return [Math.round((rp + m) * 255), Math.round((gp + m) * 255), Math.round((bp + m) * 255)];
                                                                                            };

                                                                                            const applyColor = (nr: number, ng: number, nb: number) => {
                                                                                                setColorPickerProp(prev => prev ? { ...prev, r: nr, g: ng, b: nb } : null);
                                                                                                if (selectedPath) {
                                                                                                    sendSetProperty(selectedPath, prop.name, `${(nr / 255).toFixed(6)}, ${(ng / 255).toFixed(6)}, ${(nb / 255).toFixed(6)}`);
                                                                                                }
                                                                                            };

                                                                                            const previewHex = `#${cpR.toString(16).padStart(2, "0")}${cpG.toString(16).padStart(2, "0")}${cpB.toString(16).padStart(2, "0")}`;

                                                                                            return (
                                                                                                <div
                                                                                                    data-colorpicker
                                                                                                    className="fixed z-[200] rounded-md border border-white/[0.08] shadow-xl"
                                                                                                    style={{
                                                                                                        background: "#1a1a24",
                                                                                                        boxShadow: "0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
                                                                                                        width: popupW,
                                                                                                        left: clampedLeft,
                                                                                                        top: clampedTop,
                                                                                                    }}
                                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                                >
                                                                                                    <div className="p-2.5 flex flex-col gap-2">
                                                                                                        {/* SV gradient area */}
                                                                                                        <div
                                                                                                            className="relative rounded-sm cursor-crosshair overflow-hidden"
                                                                                                            style={{
                                                                                                                width: "100%", height: 120,
                                                                                                                background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue}, 100%, 50%))`,
                                                                                                            }}
                                                                                                            onMouseDown={(e) => {
                                                                                                                const rect = e.currentTarget.getBoundingClientRect();
                                                                                                                const pick = (ev: MouseEvent) => {
                                                                                                                    const s2 = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                                                                                                                    const v2 = Math.max(0, Math.min(1, 1 - (ev.clientY - rect.top) / rect.height));
                                                                                                                    const [nr, ng, nb] = hsvToRgb(hue, s2, v2);
                                                                                                                    applyColor(nr, ng, nb);
                                                                                                                };
                                                                                                                pick(e.nativeEvent);
                                                                                                                const move = (ev: MouseEvent) => pick(ev);
                                                                                                                const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
                                                                                                                document.addEventListener("mousemove", move);
                                                                                                                document.addEventListener("mouseup", up);
                                                                                                            }}
                                                                                                        >
                                                                                                            <div className="absolute pointer-events-none" style={{
                                                                                                                left: `${sat * 100}%`, top: `${(1 - val) * 100}%`,
                                                                                                                transform: "translate(-50%, -50%)",
                                                                                                            }}>
                                                                                                                <div className="w-2.5 h-2.5 rounded-full border-2 border-white" style={{ boxShadow: "0 0 2px rgba(0,0,0,0.8)" }} />
                                                                                                            </div>
                                                                                                        </div>

                                                                                                        {/* Hue slider */}
                                                                                                        <div
                                                                                                            className="relative rounded-sm cursor-pointer"
                                                                                                            style={{
                                                                                                                width: "100%", height: 10,
                                                                                                                background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
                                                                                                            }}
                                                                                                            onMouseDown={(e) => {
                                                                                                                const rect = e.currentTarget.getBoundingClientRect();
                                                                                                                const pick = (ev: MouseEvent) => {
                                                                                                                    const hFrac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                                                                                                                    const newH = Math.round(hFrac * 360);
                                                                                                                    const [nr, ng, nb] = hsvToRgb(newH, sat, val);
                                                                                                                    applyColor(nr, ng, nb);
                                                                                                                };
                                                                                                                pick(e.nativeEvent);
                                                                                                                const move = (ev: MouseEvent) => pick(ev);
                                                                                                                const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
                                                                                                                document.addEventListener("mousemove", move);
                                                                                                                document.addEventListener("mouseup", up);
                                                                                                            }}
                                                                                                        >
                                                                                                            <div className="absolute pointer-events-none" style={{
                                                                                                                left: `${(hue / 360) * 100}%`,
                                                                                                                top: "50%", transform: "translate(-50%, -50%)",
                                                                                                            }}>
                                                                                                                <div className="w-1.5 h-3 rounded-[1px] border border-white bg-transparent" style={{ boxShadow: "0 0 2px rgba(0,0,0,0.8)" }} />
                                                                                                            </div>
                                                                                                        </div>

                                                                                                        {/* Preview + RGB inputs */}
                                                                                                        <div className="flex items-center gap-1.5">
                                                                                                            <div className="w-6 h-6 rounded-sm border border-white/10 shrink-0" style={{ backgroundColor: previewHex }} />
                                                                                                            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                                                                                                <div className="flex gap-1">
                                                                                                                    {(["R", "G", "B"] as const).map((ch, ci) => (
                                                                                                                        <div key={ch} className="flex items-center gap-0.5 flex-1 min-w-0">
                                                                                                                            <span className="text-[8px] text-white/30 shrink-0">{ch}</span>
                                                                                                                            <input
                                                                                                                                type="number" min="0" max="255"
                                                                                                                                value={[cpR, cpG, cpB][ci]}
                                                                                                                                className="w-full min-w-0 h-[16px] px-0.5 text-[9px] bg-white/[0.06] border border-white/[0.08] rounded-sm text-white/60 outline-none text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                                                                                                onChange={(e) => {
                                                                                                                                    const v = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
                                                                                                                                    const rgb = [cpR, cpG, cpB];
                                                                                                                                    rgb[ci] = v;
                                                                                                                                    applyColor(rgb[0], rgb[1], rgb[2]);
                                                                                                                                }}
                                                                                                                                onClick={(e) => e.stopPropagation()}
                                                                                                                            />
                                                                                                                        </div>
                                                                                                                    ))}
                                                                                                                </div>
                                                                                                                <span className="text-[8px] text-white/20 text-center">{previewHex.toUpperCase()}</span>
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                </div>
                                                                                            );
                                                                                        })()}
                                                                                    </div>
                                                                                );
                                                                            }
                                                                            return (
                                                                                <span
                                                                                    className={cn(
                                                                                        "truncate",
                                                                                        isReadOnly ? "text-white/25" : "text-white/40"
                                                                                    )}
                                                                                >
                                                                                    {prop.value}
                                                                                </span>
                                                                            );
                                                                        })()}
                                                                    </div>
                                                                </div>

                                                                {/* Expanded simple compound sub-rows (Vector3, Color3, etc.) */}
                                                                {compound && isExpanded && compound.map((sub, si) => {
                                                                    const subEditKey = `${prop.name}::${sub.label}`;
                                                                    const isSubEditing = editingProp?.name === subEditKey;
                                                                    return (
                                                                        <div key={subEditKey}
                                                                            className={cn("flex items-center h-[19px] border-b border-white/[0.04]",
                                                                                si % 2 === 0 ? "bg-white/[0.015]" : "bg-white/[0.03]")}
                                                                        >
                                                                            <span className="text-[10px] w-[45%] px-1.5 truncate shrink-0 border-r border-white/[0.04] text-white/35 pl-6">
                                                                                {sub.label}
                                                                            </span>
                                                                            <div
                                                                                className={cn("text-[10px] flex-1 px-1.5 flex items-center min-w-0",
                                                                                    !isReadOnly && !isSubEditing && "cursor-pointer hover:bg-white/[0.03]")}
                                                                                onClick={() => { if (!isReadOnly && !isSubEditing) setEditingProp({ name: subEditKey, value: sub.val }); }}
                                                                            >
                                                                                {isSubEditing ? (
                                                                                    <div className="flex items-center gap-0.5 flex-1 min-w-0">
                                                                                        <input
                                                                                            autoFocus
                                                                                            defaultValue={sub.val}
                                                                                            className="flex-1 min-w-0 h-[15px] px-1 text-[10px] bg-white/[0.08] border border-white/[0.15] rounded-sm text-white/80 outline-none"
                                                                                            onBlur={(e) => {
                                                                                                if (selectedPath && e.target.value !== sub.val) {
                                                                                                    const newParts = compound.map((c, ci) => ci === si ? e.target.value : c.val);
                                                                                                    sendSetProperty(selectedPath, prop.name, rebuildCompound(prop.type, newParts));
                                                                                                }
                                                                                                setEditingProp(null);
                                                                                            }}
                                                                                            onKeyDown={(e) => {
                                                                                                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); (e.target as HTMLInputElement).blur(); }
                                                                                                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditingProp(null); }
                                                                                            }}
                                                                                            onClick={(e) => e.stopPropagation()}
                                                                                        />
                                                                                        <button
                                                                                            className="shrink-0 w-3 h-3 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors"
                                                                                            onMouseDown={(e) => { e.preventDefault(); setEditingProp(null); }}
                                                                                            title="Cancel"
                                                                                        >
                                                                                            <X className="w-2.5 h-2.5" />
                                                                                        </button>
                                                                                    </div>
                                                                                ) : (
                                                                                    <span className={cn("truncate", isReadOnly ? "text-white/25" : "text-white/40")}>
                                                                                        {sub.val}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}

                                                                {/* Expanded CFrame grouped sub-rows */}
                                                                {cframeParts && isExpanded && CFRAME_GROUPS.map((group, gi) => {
                                                                    const groupKey = `${prop.name}::${group.label}`;
                                                                    const isGroupExpanded = expandedProps.has(groupKey);
                                                                    const groupVals = group.indices.map(idx => cframeParts[idx] || "0");
                                                                    const groupStr = groupVals.join(", ");
                                                                    return (
                                                                        <div key={groupKey}>
                                                                            {/* Group header (Position, RightVector, etc.) */}
                                                                            <div className={cn("flex items-center h-[19px] border-b border-white/[0.04]",
                                                                                gi % 2 === 0 ? "bg-white/[0.015]" : "bg-white/[0.03]")}>
                                                                                <span className="text-[10px] w-[45%] px-1.5 truncate shrink-0 border-r border-white/[0.04] text-white/35 pl-4 flex items-center gap-0.5">
                                                                                    <button onClick={() => {
                                                                                        setExpandedProps(prev => {
                                                                                            const next = new Set(prev);
                                                                                            if (next.has(groupKey)) next.delete(groupKey);
                                                                                            else next.add(groupKey);
                                                                                            return next;
                                                                                        });
                                                                                    }} className="shrink-0 opacity-40 hover:opacity-70 transition-opacity">
                                                                                        {isGroupExpanded
                                                                                            ? <ChevronDown className="w-2.5 h-2.5" />
                                                                                            : <ChevronRight className="w-2.5 h-2.5" />
                                                                                        }
                                                                                    </button>
                                                                                    <span className="truncate">{group.label}</span>
                                                                                </span>
                                                                                <div className="text-[10px] flex-1 px-1.5 flex items-center min-w-0">
                                                                                    <span className="truncate text-white/35">{groupStr}</span>
                                                                                </div>
                                                                            </div>
                                                                            {/* X, Y, Z within group */}
                                                                            {isGroupExpanded && group.subLabels.map((sl, si) => {
                                                                                const subKey = `${groupKey}::${sl}`;
                                                                                const subVal = groupVals[si];
                                                                                const isSubEd = editingProp?.name === subKey;
                                                                                return (
                                                                                    <div key={subKey} className={cn("flex items-center h-[19px] border-b border-white/[0.04]",
                                                                                        si % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.035]")}>
                                                                                        <span className="text-[10px] w-[45%] px-1.5 truncate shrink-0 border-r border-white/[0.04] text-white/30 pl-10">
                                                                                            {sl}
                                                                                        </span>
                                                                                        <div
                                                                                            className={cn("text-[10px] flex-1 px-1.5 flex items-center min-w-0",
                                                                                                !isReadOnly && !isSubEd && "cursor-pointer hover:bg-white/[0.03]")}
                                                                                            onClick={() => { if (!isReadOnly && !isSubEd) setEditingProp({ name: subKey, value: subVal }); }}
                                                                                        >
                                                                                            {isSubEd ? (
                                                                                                <div className="flex items-center gap-0.5 flex-1 min-w-0">
                                                                                                    <input autoFocus defaultValue={subVal}
                                                                                                        className="flex-1 min-w-0 h-[15px] px-1 text-[10px] bg-white/[0.08] border border-white/[0.15] rounded-sm text-white/80 outline-none"
                                                                                                        onBlur={(e) => {
                                                                                                            if (selectedPath && e.target.value !== subVal) {
                                                                                                                const newParts = [...cframeParts];
                                                                                                                newParts[group.indices[si]] = e.target.value;
                                                                                                                sendSetProperty(selectedPath, prop.name, newParts.join(", "));
                                                                                                            }
                                                                                                            setEditingProp(null);
                                                                                                        }}
                                                                                                        onKeyDown={(e) => {
                                                                                                            if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); (e.target as HTMLInputElement).blur(); }
                                                                                                            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditingProp(null); }
                                                                                                        }}
                                                                                                        onClick={(e) => e.stopPropagation()}
                                                                                                    />
                                                                                                    <button className="shrink-0 w-3 h-3 flex items-center justify-center text-white/30 hover:text-white/60"
                                                                                                        onMouseDown={(e) => { e.preventDefault(); setEditingProp(null); }} title="Cancel">
                                                                                                        <X className="w-2.5 h-2.5" />
                                                                                                    </button>
                                                                                                </div>
                                                                                            ) : (
                                                                                                <span className={cn("truncate", isReadOnly ? "text-white/25" : "text-white/40")}>
                                                                                                    {subVal}
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Path bar */}
                        {selectedPath && (
                            <div className="flex items-center h-[16px] px-1.5 border-t border-white/[0.06] shrink-0">
                                <span className="text-[8px] text-white/20 truncate flex-1 font-mono">{formatCopyPath(selectedPath, username)}</span>
                                <button onClick={() => { navigator.clipboard.writeText(formatCopyPath(selectedPath, username)); setCopiedPath(true); setTimeout(() => setCopiedPath(false), 1500); }}
                                    className="w-3 h-3 flex items-center justify-center shrink-0" title="Copy path">
                                    <Copy className={cn("w-2 h-2", copiedPath ? "text-emerald-400" : "text-white/20")} />
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

        </div>
    );
}

