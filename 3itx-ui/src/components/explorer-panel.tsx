"use client";

import { useState, useCallback } from "react";
import * as fsBridge from "@/lib/fs-bridge";
import {
    Search,
    FileCode,
    Folder,
    FolderOpen,
    MoreHorizontal,
    ChevronRight,
    ChevronDown,
    FolderPlus,
    FilePlus,
    Pencil,
    Trash2,
    Copy,
    ExternalLink,
    ArrowRightLeft,
    Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import ContextMenu, { type ContextMenuItem } from "@/components/context-menu";

/* ─── Data model ─── */
export interface ExplorerNode {
    id: string;
    name: string;
    type: "file" | "folder";
    content?: string;
    children?: ExplorerNode[];
    expanded?: boolean;
}

let _nodeId = 100;
function genId() {
    return `node_${_nodeId++}`;
}

interface ExplorerPanelProps {
    scriptsTree: ExplorerNode[];
    autoExecTree: ExplorerNode[];
    onScriptsChange: React.Dispatch<React.SetStateAction<ExplorerNode[]>>;
    onAutoExecChange: React.Dispatch<React.SetStateAction<ExplorerNode[]>>;
    activeFile: string | null;
    onFileClick: (node: ExplorerNode, section: "scripts" | "autoexec") => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    onRefresh?: () => void;
}

/* ─── Helpers ─── */
function addNodeToTree(tree: ExplorerNode[], parentId: string | null, node: ExplorerNode): ExplorerNode[] {
    if (!parentId) return [...tree, node];
    return tree.map((n) => {
        if (n.id === parentId && n.type === "folder") {
            return { ...n, children: [...(n.children || []), node], expanded: true };
        }
        if (n.children) return { ...n, children: addNodeToTree(n.children, parentId, node) };
        return n;
    });
}

function findNodePath(tree: ExplorerNode[], nodeId: string, prefix = ""): string | null {
    for (const n of tree) {
        const currentPath = prefix ? `${prefix}/${n.name}` : n.name;
        if (n.id === nodeId) return currentPath;
        if (n.children) {
            const found = findNodePath(n.children, nodeId, currentPath);
            if (found) return found;
        }
    }
    return null;
}

function removeNodeFromTree(tree: ExplorerNode[], nodeId: string): ExplorerNode[] {
    return tree
        .filter((n) => n.id !== nodeId)
        .map((n) => (n.children ? { ...n, children: removeNodeFromTree(n.children, nodeId) } : n));
}

function renameNodeInTree(tree: ExplorerNode[], nodeId: string, newName: string): ExplorerNode[] {
    return tree.map((n) => {
        if (n.id === nodeId) return { ...n, name: newName };
        if (n.children) return { ...n, children: renameNodeInTree(n.children, nodeId, newName) };
        return n;
    });
}

function toggleFolderInTree(tree: ExplorerNode[], nodeId: string): ExplorerNode[] {
    return tree.map((n) => {
        if (n.id === nodeId && n.type === "folder") return { ...n, expanded: !n.expanded };
        if (n.children) return { ...n, children: toggleFolderInTree(n.children, nodeId) };
        return n;
    });
}

function filterTree(tree: ExplorerNode[], query: string): ExplorerNode[] {
    if (!query) return tree;
    const q = query.toLowerCase();
    return tree
        .map((n) => {
            if (n.type === "folder") {
                const fc = filterTree(n.children || [], query);
                if (fc.length > 0 || n.name.toLowerCase().includes(q)) return { ...n, children: fc, expanded: true };
                return null;
            }
            return n.name.toLowerCase().includes(q) ? n : null;
        })
        .filter(Boolean) as ExplorerNode[];
}

/* ─── Component ─── */
export default function ExplorerPanel({
    scriptsTree,
    autoExecTree,
    onScriptsChange,
    onAutoExecChange,
    activeFile,
    onFileClick,
    searchQuery,
    onSearchChange,
    onRefresh,
}: ExplorerPanelProps) {
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        items: ContextMenuItem[];
    } | null>(null);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [scriptsExpanded, setScriptsExpanded] = useState(true);
    const [autoExecExpanded, setAutoExecExpanded] = useState(true);

    const filteredScripts = filterTree(scriptsTree, searchQuery);
    const filteredAutoExec = filterTree(autoExecTree, searchQuery);

    /* Persist mutation to disk (fire-and-forget — the in-memory tree is already updated) */
    const persistToDisk = useCallback(async (action: string, root: string, filePath: string, extra?: Record<string, string>) => {
        try {
            const section = root as "scripts" | "autoexec";
            switch (action) {
                case "createFile": await fsBridge.createFile(section, filePath); break;
                case "createFolder": await fsBridge.createFolder(section, filePath); break;
                case "delete": await fsBridge.deleteFile(section, filePath); break;
                case "rename": await fsBridge.renameFile(section, filePath, extra?.newName ?? ""); break;
                case "openFolder": await fsBridge.openFolder(section, filePath); break;
                case "moveToSection": await fsBridge.moveToSection(section, (extra?.toRoot ?? "autoexec") as "scripts" | "autoexec", filePath); break;
                case "moveInFolder": await fsBridge.moveInFolder(section, filePath, extra?.toFolder ?? ""); break;
            }
            // Do NOT call onRefresh here — the in-memory tree is already correct.
            // Calling onRefresh would re-fetch from disk with new IDs, wiping editing state.
        } catch { }
    }, []);

    const createFile = useCallback(
        (parentId: string | null, section: "scripts" | "autoexec") => {
            const id = genId();
            const node: ExplorerNode = { id, name: "untitled.lua", type: "file", content: "" };
            const setter = section === "scripts" ? onScriptsChange : onAutoExecChange;
            setter((prev: ExplorerNode[]) => addNodeToTree(prev, parentId, node));
            setEditingId(id);
            setEditingName("untitled.lua");
        },
        [onScriptsChange, onAutoExecChange]
    );

    const createFolder = useCallback(
        (parentId: string | null, section: "scripts" | "autoexec") => {
            const id = genId();
            const node: ExplorerNode = { id, name: "New Folder", type: "folder", children: [], expanded: true };
            const setter = section === "scripts" ? onScriptsChange : onAutoExecChange;
            setter((prev: ExplorerNode[]) => addNodeToTree(prev, parentId, node));
            setEditingId(id);
            setEditingName("New Folder");
        },
        [onScriptsChange, onAutoExecChange]
    );

    const deleteNode = useCallback(
        (nodeId: string, nodeName: string, section: "scripts" | "autoexec") => {
            const setter = section === "scripts" ? onScriptsChange : onAutoExecChange;
            setter((prev: ExplorerNode[]) => removeNodeFromTree(prev, nodeId));
            persistToDisk("delete", section, nodeName);
        },
        [onScriptsChange, onAutoExecChange, persistToDisk]
    );

    const finishRename = useCallback(
        (nodeId: string, oldName: string, section: "scripts" | "autoexec") => {
            if (editingName.trim()) {
                const setter = section === "scripts" ? onScriptsChange : onAutoExecChange;
                setter((prev: ExplorerNode[]) => renameNodeInTree(prev, nodeId, editingName.trim()));
                // If it's a brand new file (untitled.lua) -> create via API
                if (oldName === "untitled.lua" || oldName === "New Folder") {
                    const isFolder = oldName === "New Folder";
                    persistToDisk(isFolder ? "createFolder" : "createFile", section, editingName.trim());
                } else {
                    persistToDisk("rename", section, oldName, { newName: editingName.trim() });
                }
            }
            setEditingId(null);
            setEditingName("");
        },
        [onScriptsChange, onAutoExecChange, editingName, persistToDisk]
    );

    const toggleFolder = useCallback(
        (nodeId: string, section: "scripts" | "autoexec") => {
            const setter = section === "scripts" ? onScriptsChange : onAutoExecChange;
            setter((prev: ExplorerNode[]) => toggleFolderInTree(prev, nodeId));
        },
        [onScriptsChange, onAutoExecChange]
    );

    const moveToOtherSection = useCallback(
        (node: ExplorerNode, fromSection: "scripts" | "autoexec") => {
            const toSection = fromSection === "scripts" ? "autoexec" : "scripts";
            // Remove from source tree
            const setter = fromSection === "scripts" ? onScriptsChange : onAutoExecChange;
            setter((prev: ExplorerNode[]) => removeNodeFromTree(prev, node.id));
            // Persist move to disk
            persistToDisk("moveToSection", fromSection, node.name, { toRoot: toSection });
            // Refresh to show in destination
            if (onRefresh) setTimeout(onRefresh, 300);
        },
        [onScriptsChange, onAutoExecChange, persistToDisk, onRefresh]
    );

    const buildFileMenu = (node: ExplorerNode, section: "scripts" | "autoexec"): ContextMenuItem[] => [
        {
            label: "Rename", icon: <Pencil className="w-3 h-3" />,
            action: () => { setEditingId(node.id); setEditingName(node.name); },
        },
        {
            label: "Duplicate", icon: <Copy className="w-3 h-3" />,
            action: () => {
                const id = genId();
                const dup: ExplorerNode = { ...node, id, name: `${node.name} copy` };
                const setter = section === "scripts" ? onScriptsChange : onAutoExecChange;
                setter((prev: ExplorerNode[]) => [...prev, dup]);
            },
        },
        { label: "", action: () => { }, separator: true },
        {
            label: section === "scripts" ? "Move to Auto Execution" : "Move to Scripts",
            icon: <ArrowRightLeft className="w-3 h-3" />,
            action: () => moveToOtherSection(node, section),
        },
        { label: "", action: () => { }, separator: true },
        {
            label: "Delete", icon: <Trash2 className="w-3 h-3" />,
            action: () => deleteNode(node.id, node.name, section), danger: true,
        },
    ];

    const buildFolderMenu = (node: ExplorerNode, section: "scripts" | "autoexec"): ContextMenuItem[] => [
        { label: "New File", icon: <FilePlus className="w-3 h-3" />, action: () => createFile(node.id, section) },
        { label: "New Folder", icon: <FolderPlus className="w-3 h-3" />, action: () => createFolder(node.id, section) },
        { label: "", action: () => { }, separator: true },
        {
            label: "Rename", icon: <Pencil className="w-3 h-3" />,
            action: () => { setEditingId(node.id); setEditingName(node.name); },
        },
        { label: "", action: () => { }, separator: true },
        {
            label: section === "scripts" ? "Move to Auto Execution" : "Move to Scripts",
            icon: <ArrowRightLeft className="w-3 h-3" />,
            action: () => moveToOtherSection(node, section),
        },
        { label: "", action: () => { }, separator: true },
        { label: "Delete", icon: <Trash2 className="w-3 h-3" />, action: () => deleteNode(node.id, node.name, section), danger: true },
    ];

    const buildSectionMenu = (section: "scripts" | "autoexec"): ContextMenuItem[] => [
        { label: "New File", icon: <FilePlus className="w-3 h-3" />, action: () => createFile(null, section) },
        { label: "New Folder", icon: <FolderPlus className="w-3 h-3" />, action: () => createFolder(null, section) },
        { label: "", action: () => { }, separator: true },
        {
            label: `Open ${section === "scripts" ? "Scripts" : "AutoExec"} Folder`,
            icon: <ExternalLink className="w-3 h-3" />,
            action: () => persistToDisk("openFolder", section, ""),
        },
    ];

    /* Drag & drop */
    const handleDragStart = (_e: React.DragEvent, node: ExplorerNode) => {
        _e.dataTransfer.setData("text/plain", node.id);
        _e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent, node: ExplorerNode) => {
        if (node.type === "folder") {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverId(node.id);
        }
    };

    const handleDrop = (e: React.DragEvent, targetFolder: ExplorerNode, section: "scripts" | "autoexec") => {
        e.preventDefault();
        setDragOverId(null);
        const draggedId = e.dataTransfer.getData("text/plain");
        if (draggedId === targetFolder.id) return;

        const tree = section === "scripts" ? scriptsTree : autoExecTree;
        const setter = section === "scripts" ? onScriptsChange : onAutoExecChange;

        function findNode(nodes: ExplorerNode[], id: string): ExplorerNode | null {
            for (const n of nodes) {
                if (n.id === id) return n;
                if (n.children) { const f = findNode(n.children, id); if (f) return f; }
            }
            return null;
        }

        const dragged = findNode(tree, draggedId);
        if (!dragged) return;

        // Find current path of dragged item and target folder path
        const draggedPath = findNodePath(tree, draggedId);
        const folderPath = findNodePath(tree, targetFolder.id);

        const withoutDragged = removeNodeFromTree(tree, draggedId);
        setter(addNodeToTree(withoutDragged, targetFolder.id, dragged));

        // Persist the move to disk
        if (draggedPath && folderPath) {
            persistToDisk("moveInFolder", section, draggedPath, { toFolder: folderPath });
        }
    };

    /* Render tree node */
    const renderNode = (node: ExplorerNode, depth: number, section: "scripts" | "autoexec") => {
        const isEditing = editingId === node.id;
        const isActive = node.type === "file" && activeFile === `${section}:${node.name}`;
        const isDragOver = dragOverId === node.id;

        return (
            <div key={node.id} className="animate-fade-slide-in">
                <div
                    draggable={!isEditing}
                    onDragStart={(e) => handleDragStart(e, node)}
                    onDragOver={(e) => handleDragOver(e, node)}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={(e) => handleDrop(e, node, section)}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const items = node.type === "folder" ? buildFolderMenu(node, section) : buildFileMenu(node, section);
                        setContextMenu({ x: e.clientX, y: e.clientY, items });
                    }}
                    onClick={() => {
                        if (isEditing) return;
                        if (node.type === "folder") toggleFolder(node.id, section);
                        else onFileClick(node, section);
                    }}
                    className={cn(
                        "group flex items-center gap-1.5 w-full px-2 py-[3px] text-[11px] cursor-pointer transition-all duration-150 rounded-[3px]",
                        isActive
                            ? "bg-white/[0.08] text-foreground font-medium"
                            : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                        isDragOver && "bg-white/[0.1] ring-1 ring-white/[0.2]"
                    )}
                    style={{ paddingLeft: `${12 + depth * 14}px` }}
                >
                    {node.type === "folder" ? (
                        <>
                            {node.expanded ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />}
                            {node.expanded ? <FolderOpen className="w-3 h-3 shrink-0 text-amber-400/70" /> : <Folder className="w-3 h-3 shrink-0 text-amber-400/70" />}
                        </>
                    ) : (
                        <FileCode className="w-3 h-3 shrink-0 ml-[15px] text-blue-400/60" />
                    )}

                    {isEditing ? (
                        <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => finishRename(node.id, node.name, section)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") finishRename(node.id, node.name, section);
                                if (e.key === "Escape") { setEditingId(null); setEditingName(""); }
                            }}
                            className="flex-1 bg-white/[0.06] text-foreground text-[11px] px-1 py-0.5 rounded border border-white/[0.1] outline-none"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <span className="truncate">{node.name}</span>
                    )}
                </div>

                {node.type === "folder" && node.expanded && node.children && (
                    <div>
                        {node.children.map((child) => renderNode(child, depth + 1, section))}
                    </div>
                )}
            </div>
        );
    };

    /* Section header */
    const renderSectionHeader = (label: string, section: "scripts" | "autoexec", expanded: boolean, toggle: () => void) => (
        <div
            className="flex items-center justify-between px-2.5 py-1.5 cursor-pointer hover:bg-white/[0.02] transition-colors"
            onClick={toggle}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, items: buildSectionMenu(section) });
            }}
        >
            <div className="flex items-center gap-1.5">
                {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); createFile(null, section); }}
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100"
            >
                <Plus className="w-3 h-3" />
            </button>
        </div>
    );

    return (
        <div
            className="flex flex-col w-[200px] bg-[#0c0c0e] border-r border-white/[0.06] shrink-0 select-none overflow-hidden animate-panel-in"
            onContextMenu={(e) => {
                if ((e.target as HTMLElement).closest("[draggable]")) return;
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, items: buildSectionMenu("scripts") });
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between h-[36px] px-3 border-b border-white/[0.06] shrink-0">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Explorer
                </span>
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={() => createFile(null, "scripts")}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                        title="New File"
                    >
                        <FilePlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => createFolder(null, "scripts")}
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                        title="New Folder"
                    >
                        <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                        onClick={(e) => {
                            e.stopPropagation();
                            setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                items: [
                                    {
                                        label: "Open Script Folder",
                                        icon: <ExternalLink className="w-3 h-3" />,
                                        action: () => fsBridge.openExternalFolder("scripts"),
                                    },
                                    {
                                        label: "Open UI AutoExec Folder",
                                        icon: <ExternalLink className="w-3 h-3" />,
                                        action: () => fsBridge.openExternalFolder("autoexec"),
                                    },
                                    { label: "", action: () => { }, separator: true },
                                    {
                                        label: "Open Executor AutoExec Folder",
                                        icon: <ExternalLink className="w-3 h-3" />,
                                        action: () => fsBridge.openExternalFolder("synapseAutoExec"),
                                    },
                                    {
                                        label: "Open Workspace Folder",
                                        icon: <ExternalLink className="w-3 h-3" />,
                                        action: () => fsBridge.openExternalFolder("synapseWorkspace"),
                                    },
                                ],
                            });
                        }}
                        title="More Options"
                    >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="px-2.5 py-2 border-b border-white/[0.06] shrink-0">
                <div className="flex items-center gap-2 h-7 px-2 bg-white/[0.04] rounded-md">
                    <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                    <input
                        type="text"
                        placeholder="Search"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground border-none outline-none"
                    />
                </div>
            </div>

            {/* Tree */}
            <ScrollArea className="flex-1">
                <div className="py-1">
                    {/* SCRIPTS section */}
                    <div className="group">
                        {renderSectionHeader("Scripts", "scripts", scriptsExpanded, () => setScriptsExpanded(!scriptsExpanded))}
                        {scriptsExpanded && (
                            <div className="animate-fade-slide-in">
                                {filteredScripts.length > 0 ? (
                                    filteredScripts.map((node) => renderNode(node, 0, "scripts"))
                                ) : (
                                    <div className="px-4 py-2">
                                        <span className="text-[10px] text-muted-foreground/60">No files found</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* AUTO EXECUTION section */}
                    <div className="group mt-1">
                        {renderSectionHeader("Auto Execution", "autoexec", autoExecExpanded, () => setAutoExecExpanded(!autoExecExpanded))}
                        {autoExecExpanded && (
                            <div className="animate-fade-slide-in">
                                {filteredAutoExec.length > 0 ? (
                                    filteredAutoExec.map((node) => renderNode(node, 0, "autoexec"))
                                ) : (
                                    <div className="px-4 py-2">
                                        <span className="text-[10px] text-muted-foreground/60">No files found</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </ScrollArea>

            {/* Context menu */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={contextMenu.items}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}
