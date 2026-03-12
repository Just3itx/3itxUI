-- 3itx Init Script — connects Roblox instance to 3itx UI
-- This script is auto-injected into each Synapse Z instance
-- Uses getgenv() guard to prevent double execution

if not game:IsLoaded() then game.Loaded:Wait() end

if getgenv().__3itx_initialized then return end
getgenv().__3itx_initialized = true

-- cloneref makes service references undetectable by anti-cheat scripts
local cloneref = cloneref or function(o) return o end

local HttpService = cloneref(game:GetService("HttpService"))
local Players = cloneref(game:GetService("Players"))
local player = Players.LocalPlayer

-- PID is baked in by the launcher at injection time
local pid = {{PID}}

local placeName = ""
pcall(function()
    placeName = cloneref(game:GetService("MarketplaceService")):GetProductInfo(game.PlaceId).Name
end)

local info = HttpService:JSONEncode({
    type = "hello",
    pid = pid,
    userId = player.UserId,
    username = player.Name,
    displayName = player.DisplayName,
    placeId = game.PlaceId,
    placeName = placeName,
    jobId = game.JobId
})

-- WebSocket connection with reconnect
local WS_URL = "ws://localhost:{{WS_PORT}}"
local ws = nil
local connected = false

-- ─── Console redirect (hookfunction) ───
local _origPrint = nil
local _origWarn = nil
local _origError = nil
local _consoleRedirectEnabled = false

local function sendLog(level, ...)
    if not connected or not ws then return end
    local parts = {}
    for i = 1, select("#", ...) do
        parts[i] = tostring(select(i, ...))
    end
    local message = table.concat(parts, "\t")
    pcall(function()
        ws:Send(HttpService:JSONEncode({
            type = "log",
            level = level,
            message = message
        }))
    end)
end

-- Clone hookfunction so anti-cheats can't trace the original reference
local _hookfunction = (clonefunction and hookfunction) and clonefunction(hookfunction) or hookfunction

local function enableConsoleRedirect()
    if _consoleRedirectEnabled then return end
    _consoleRedirectEnabled = true

    local env = getfenv()

    -- Hook print — redirect only to UI, suppress Roblox console
    if _hookfunction and env.print then
        _origPrint = _hookfunction(env.print, function(...)
            sendLog("info", ...)
        end)
    end

    -- Hook warn — redirect only to UI, suppress Roblox console
    if _hookfunction and env.warn then
        _origWarn = _hookfunction(env.warn, function(...)
            sendLog("warning", ...)
        end)
    end

    -- Hook error — send to UI then still throw (error controls flow)
    if _hookfunction and env.error then
        _origError = _hookfunction(env.error, function(msg, ...)
            sendLog("error", msg)
            if _origError then _origError(msg, ...) end
        end)
    end
end

local function disableConsoleRedirect()
    if not _consoleRedirectEnabled then return end
    _consoleRedirectEnabled = false

    local env = getfenv()
    if _origPrint and _hookfunction then
        pcall(function() _hookfunction(env.print, _origPrint) end)
        _origPrint = nil
    end
    if _origWarn and _hookfunction then
        pcall(function() _hookfunction(env.warn, _origWarn) end)
        _origWarn = nil
    end
    if _origError and _hookfunction then
        pcall(function() _hookfunction(env.error, _origError) end)
        _origError = nil
    end
end

-- ─── LSP Connect — serialize game tree over WebSocket ───
local _lspEnabled = false
local _lspConnections = {}

local function wsSend(payload)
    if not connected or not ws then return end
    pcall(function()
        ws:Send(HttpService:JSONEncode(payload))
    end)
end

local function getInstanceInfo(inst, maxDepth, depth)
    depth = depth or 0
    maxDepth = maxDepth or 3
    local children = {}
    if depth < maxDepth then
        local ok, kids = pcall(function() return inst:GetChildren() end)
        if ok then
            for _, child in kids do
                table.insert(children, getInstanceInfo(child, maxDepth, depth + 1))
            end
        end
    end
    return {
        name = inst.Name,
        className = inst.ClassName,
        children = children,
    }
end

local function enableLSP()
    if _lspEnabled then return end
    _lspEnabled = true

    -- Send initial game tree (services at depth 0, children at depth 2)
    task.spawn(function()
        local services = {}
        local serviceList = {
            "Workspace", "Players", "Lighting", "ReplicatedFirst",
            "ReplicatedStorage", "ServerScriptService", "ServerStorage",
            "StarterGui", "StarterPack", "StarterPlayer", "Teams",
            "SoundService", "Chat", "TextChatService", "TweenService",
            "UserInputService", "RunService", "Debris", "PhysicsService",
            "PathfindingService", "CollectionService", "MarketplaceService",
            "TeleportService", "HttpService", "ContextActionService",
            "GuiService", "HapticService", "VRService", "LocalizationService",
            "PolicyService", "MemoryStoreService", "MessagingService",
            "DataStoreService", "BadgeService", "InsertService",
            "GamePassService", "AssetService", "GroupService",
            "ContentProvider", "TestService", "ProximityPromptService",
        }

        for _, name in serviceList do
            pcall(function()
                local svc = cloneref(game:GetService(name))
                table.insert(services, getInstanceInfo(svc, 2, 0))
            end)
        end

        wsSend({
            type = "lsp_init",
            services = services,
        })

        -- Track descendant changes in Workspace for live updates
        local workspaceConn = cloneref(game:GetService("Workspace")).DescendantAdded:Connect(function(inst)
            if not _lspEnabled then return end
            task.defer(function()
                wsSend({
                    type = "lsp_add",
                    parent = inst.Parent and inst.Parent:GetFullName() or "",
                    info = {
                        name = inst.Name,
                        className = inst.ClassName,
                        children = {},
                    }
                })
            end)
        end)
        table.insert(_lspConnections, workspaceConn)

        local removeConn = cloneref(game:GetService("Workspace")).DescendantRemoving:Connect(function(inst)
            if not _lspEnabled then return end
            task.defer(function()
                wsSend({
                    type = "lsp_remove",
                    parent = inst.Parent and inst.Parent:GetFullName() or "",
                    name = inst.Name,
                })
            end)
        end)
        table.insert(_lspConnections, removeConn)

        -- Periodic full rescan every 30s to keep data fresh
        task.spawn(function()
            while _lspEnabled and connected do
                task.wait(30)
                if not _lspEnabled then break end
                local refreshServices = {}
                for _, svcName in serviceList do
                    pcall(function()
                        local svc = cloneref(game:GetService(svcName))
                        table.insert(refreshServices, getInstanceInfo(svc, 2, 0))
                    end)
                end
                wsSend({
                    type = "lsp_init",
                    services = refreshServices,
                })
            end
        end)
    end)
end

local function disableLSP()
    if not _lspEnabled then return end
    _lspEnabled = false
    for _, conn in _lspConnections do
        pcall(function() conn:Disconnect() end)
    end
    _lspConnections = {}
end

-- Handle incoming messages (execute commands + ping/pong heartbeat + console redirect + LSP)
local function onMessage(msg)
    local ok, data = pcall(HttpService.JSONDecode, HttpService, msg)
    if not ok then return end

    if data.type == "execute" and (data.script or data.code) then
        local source = data.script or data.code
        local fn, compileErr = loadstring(source)
        if fn then
            task.spawn(function()
                local ok2, runtimeErr = xpcall(fn, debug.traceback)
                if not ok2 then sendLog("error", tostring(runtimeErr)) end
            end)
        else
            sendLog("error", tostring(compileErr))
        end
    elseif data.type == "ping" then
        pcall(function()
            if ws then
                ws:Send(HttpService:JSONEncode({ type = "pong" }))
            end
        end)
    elseif data.type == "enableConsoleRedirect" then
        if data.enabled then
            enableConsoleRedirect()
        else
            disableConsoleRedirect()
        end
    elseif data.type == "enableLSP" then
        if data.enabled then
            enableLSP()
        else
            disableLSP()
        end
    end
end

local function connect()
    local ok = pcall(function()
        ws = WebSocket.connect(WS_URL)
        connected = true
        ws:Send(info)
        ws.OnMessage:Connect(onMessage)
        ws.OnClose:Connect(function()
            connected = false
            ws = nil
            -- Disable redirect + LSP on disconnect
            disableConsoleRedirect()
            disableLSP()
            -- Retry reconnection in a loop
            task.spawn(function()
                while not connected do
                    task.wait(3)
                    connect()
                end
            end)
        end)
    end)
    if not ok then
        connected = false
        ws = nil
    end
end

-- Failsafe: watch for 3itx_status.txt in workspace
task.spawn(function()
    while true do
        task.wait(5)
        if not connected then
            pcall(function()
                if isfile and isfile("3itx_status.txt") then
                    local content = readfile("3itx_status.txt")
                    if content:find("OK") then
                        delfile("3itx_status.txt")
                        connect()
                    end
                end
            end)
        end
    end
end)

connect()
