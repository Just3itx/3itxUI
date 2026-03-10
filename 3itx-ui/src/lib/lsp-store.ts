"use client";

/**
 * LSP Store — stores live game instance trees received from Roblox instances.
 * Each connected client (identified by PID) can have its own game tree.
 * Provides lookup methods for Monaco completion provider.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface LspNode {
    name: string;
    className: string;
    children: LspNode[];
}

/** Per-client game trees keyed by PID */
const _trees: Map<number, LspNode[]> = new Map();

/** Listeners notified when the tree changes */
const _listeners: Set<() => void> = new Set();

export function subscribe(fn: () => void) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

function notify() {
    _listeners.forEach(fn => fn());
}

/** Handle an lsp_init message — full services tree */
export function handleLspInit(pid: number, data: any) {
    const services: LspNode[] = Array.isArray(data.services) ? data.services : [];
    _trees.set(pid, services);
    notify();
}

/** Handle an lsp_add message — new descendant */
export function handleLspAdd(pid: number, data: any) {
    const tree = _trees.get(pid);
    if (!tree) return;
    const parentPath: string = data.parent || "";
    const info: LspNode = data.info;
    if (!info) return;

    // Find the parent node by full name path (e.g., "Workspace.Folder.SubFolder")
    const parent = findNodeByPath(tree, parentPath);
    if (parent) {
        parent.children.push(info);
        notify();
    }
}

/** Handle an lsp_remove message — descendant removed */
export function handleLspRemove(pid: number, data: any) {
    const tree = _trees.get(pid);
    if (!tree) return;
    const parentPath: string = data.parent || "";
    const name: string = data.name || "";
    if (!name) return;

    const parent = findNodeByPath(tree, parentPath);
    if (parent) {
        const idx = parent.children.findIndex(c => c.name === name);
        if (idx !== -1) {
            parent.children.splice(idx, 1);
            notify();
        }
    }
}

/** Remove a client's tree (on disconnect) */
export function removeClient(pid: number) {
    _trees.delete(pid);
    notify();
}

/** Get all services for a given PID (or the first available) */
export function getServices(pid?: number): LspNode[] {
    if (pid !== undefined) return _trees.get(pid) || [];
    // Return the first available tree
    for (const tree of _trees.values()) return tree;
    return [];
}

/** Get children of a service by name (e.g., "Workspace") */
export function getServiceChildren(serviceName: string, pid?: number): LspNode[] {
    const services = getServices(pid);
    const svc = services.find(s => s.name === serviceName);
    return svc?.children || [];
}

/** Get children at a specific dot path (e.g., "game.Workspace.Part") */
export function getChildrenAtPath(parts: string[], pid?: number): LspNode[] {
    const services = getServices(pid);
    if (parts.length === 0) return [];

    // parts[0] should be "game", parts[1] is the service name, etc.
    let current: LspNode | undefined;
    const startIdx = parts[0] === "game" ? 1 : 0;

    for (let i = startIdx; i < parts.length; i++) {
        const name = parts[i];
        if (i === startIdx) {
            current = services.find(s => s.name === name);
        } else if (current) {
            current = current.children.find(c => c.name === name);
        }
        if (!current) return [];
    }

    return current?.children || [];
}

/** Check if any tree data is available */
export function hasData(): boolean {
    return _trees.size > 0;
}

// ─── Internal helpers ───

function findNodeByPath(roots: LspNode[], fullName: string): LspNode | undefined {
    if (!fullName) return undefined;
    // fullName is like "Workspace" or "Workspace.Folder.SubFolder"
    const parts = fullName.split(".");
    let current: LspNode | undefined;
    for (let i = 0; i < parts.length; i++) {
        const name = parts[i];
        if (i === 0) {
            current = roots.find(r => r.name === name);
        } else if (current) {
            current = current.children.find(c => c.name === name);
        }
        if (!current) return undefined;
    }
    return current;
}
