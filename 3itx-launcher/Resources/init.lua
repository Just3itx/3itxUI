-- 3itx Init Script — connects Roblox instance to 3itx UI
-- This script is auto-injected into each Synapse Z instance
-- Uses getgenv() guard to prevent double execution

if not game:IsLoaded() then game.Loaded:Wait() end

-- Guard: skip if already connected; allow re-run if not connected
if getgenv().__3itx_connected then return end
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
    elseif data.type == "dex_getChildren" then
        -- Resolve an instance path and return its children
        task.spawn(function()
            local path = data.path or "game"
            local requestId = data.requestId or ""
            local ok, result = pcall(function()
                local target

                if path == "nil" then
                    -- Return root nil instances
                    if not getnilinstances then return {} end
                    local nilInsts = getnilinstances()
                    local children = {}
                    for _, obj in nilInsts do
                        if obj ~= game and obj.Parent == nil then
                            local hasKids = false
                            pcall(function() hasKids = #obj:GetChildren() > 0 end)
                            local debugId = ""
                            pcall(function() debugId = obj:GetDebugId() end)
                            table.insert(children, {
                                name = obj.Name,
                                className = obj.ClassName,
                                hasChildren = hasKids,
                                debugId = debugId,
                            })
                        end
                    end
                    return children
                elseif string.sub(path, 1, 4) == "nil." then
                    -- Resolve nil instance by debugId chain
                    local rawParts = {}
                    for part in string.gmatch(path, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    -- First segment after "nil" is a debugId
                    local rootDebugId = rawParts[2]
                    if not rootDebugId or not getnilinstances then return nil end
                    -- Find root nil instance by debugId
                    target = nil
                    for _, obj in getnilinstances() do
                        local did = ""
                        pcall(function() did = obj:GetDebugId() end)
                        if did == rootDebugId then target = obj; break end
                    end
                    if not target then return nil end
                    -- Traverse remaining segments (children of nil instance)
                    for i = 3, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local count = 0
                        local match = nil
                        for _, c in target:GetChildren() do
                            if c.Name == name then
                                count = count + 1
                                if count == idx then match = c; break end
                            end
                        end
                        target = match
                        if not target then return nil end
                    end
                elseif path == "game" then
                    target = game
                else
                    -- Parse path segments, each may have [index] suffix
                    local rawParts = {}
                    for part in string.gmatch(path, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    target = game
                    for i = 2, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local found = false
                        if i == 2 then
                            pcall(function()
                                target = cloneref(game:GetService(name))
                                found = true
                            end)
                        end
                        if not found then
                            local count = 0
                            local match = nil
                            for _, c in target:GetChildren() do
                                if c.Name == name then
                                    count = count + 1
                                    if count == idx then match = c; break end
                                end
                            end
                            target = match
                        end
                        if not target then return nil end
                    end
                end
                if not target then return nil end

                local children = {}
                local ok2, kids = pcall(function() return target:GetChildren() end)
                if ok2 and kids then
                    -- Count names for disambiguation
                    local nameCounts = {}
                    local nameIndices = {}
                    for _, child in kids do
                        nameCounts[child.Name] = (nameCounts[child.Name] or 0) + 1
                    end
                    for _, child in kids do
                        local nm = child.Name
                        nameIndices[nm] = (nameIndices[nm] or 0) + 1
                        local displayName = nm
                        if nameCounts[nm] > 1 then
                            displayName = nm .. "[" .. tostring(nameIndices[nm]) .. "]"
                        end
                        local hasChildren = false
                        pcall(function() hasChildren = #child:GetChildren() > 0 end)
                        table.insert(children, {
                            name = displayName,
                            className = child.ClassName,
                            hasChildren = hasChildren,
                        })
                    end
                end
                return children
            end)
            wsSend({
                type = "dex_children",
                requestId = requestId,
                path = path,
                children = result or {},
            })
        end)
    elseif data.type == "dex_getProperties" then
        task.spawn(function()
            local path = data.path or ""
            local requestId = data.requestId or ""
            local showHidden = data.showHidden or false

            local properties = {}

            -- Resolve instance
            local target = nil
            pcall(function()
                if string.sub(path, 1, 4) == "nil." then
                    -- Resolve nil instance by debugId chain
                    local rawParts = {}
                    for part in string.gmatch(path, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    local rootDebugId = rawParts[2]
                    if not rootDebugId or not getnilinstances then return end
                    for _, obj in getnilinstances() do
                        local did = ""
                        pcall(function() did = obj:GetDebugId() end)
                        if did == rootDebugId then target = obj; break end
                    end
                    if not target then return end
                    for i = 3, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local count = 0
                        local match = nil
                        for _, c in target:GetChildren() do
                            if c.Name == name then
                                count = count + 1
                                if count == idx then match = c; break end
                            end
                        end
                        target = match
                        if not target then return end
                    end
                else
                    local rawParts = {}
                    for part in string.gmatch(path, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    target = game
                    for i = 2, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local found = false
                        if i == 2 then
                            pcall(function()
                                target = cloneref(game:GetService(name))
                                found = true
                            end)
                        end
                        if not found then
                            local count = 0
                            local match = nil
                            for _, c in target:GetChildren() do
                                if c.Name == name then
                                    count = count + 1
                                    if count == idx then match = c; break end
                                end
                            end
                            target = match
                        end
                        if not target then return end
                    end
                end
            end)

            if not target then
                wsSend({ type = "dex_properties", requestId = requestId, path = path, properties = {} })
                return
            end

            -- Fetch API dump and build property info (cached in getgenv)
            -- V5: stores ALL properties including hidden/NotScriptable with tags
            if not getgenv().__dexApiPropsV5 then
                pcall(function()
                    local dumpJson = game:HttpGet("https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/refs/heads/roblox/Full-API-Dump.json")
                    local dump = HttpService:JSONDecode(dumpJson)
                    local props = {}
                    local superclass = {}
                    if dump and dump.Classes then
                        for _, cls in pairs(dump.Classes) do
                            props[cls.Name] = {}
                            if cls.Superclass then
                                superclass[cls.Name] = cls.Superclass
                            end
                            if cls.Members then
                                for _, member in pairs(cls.Members) do
                                    if member.MemberType == "Property" then
                                        local isHidden = false
                                        local isNotScriptable = false
                                        local isDeprecated = false
                                        local isReadOnly = false
                                        if member.Tags then
                                            for _, tag in pairs(member.Tags) do
                                                if type(tag) == "string" then
                                                    if tag == "NotScriptable" then isNotScriptable = true end
                                                    if tag == "Hidden" then isHidden = true end
                                                    if tag == "Deprecated" then isDeprecated = true end
                                                    if tag == "ReadOnly" then isReadOnly = true end
                                                end
                                            end
                                        end
                                        -- Check security
                                        local canRead = true
                                        if member.Security then
                                            local readSec = member.Security
                                            if type(readSec) == "table" then
                                                readSec = readSec.Read or "None"
                                            end
                                            if readSec ~= "None" and readSec ~= "PluginSecurity" then
                                                canRead = false
                                            end
                                        end
                                        -- Store ALL properties with metadata
                                        if canRead then
                                            local entry = {
                                                name = member.Name,
                                                category = member.Category or "Other",
                                                readOnly = isReadOnly or nil,
                                                valueType = member.ValueType and member.ValueType.Name or "",
                                                valueCategory = member.ValueType and member.ValueType.Category or "",
                                                hidden = isHidden or nil,
                                                notScriptable = isNotScriptable or nil,
                                            }
                                            if isDeprecated then entry.deprecated = true end
                                            table.insert(props[cls.Name], entry)
                                        end
                                    end
                                end
                            end
                        end
                    end
                    getgenv().__dexApiPropsV5 = props
                    getgenv().__dexApiSuperclass = superclass
                end)
            end

            local apiProps = getgenv().__dexApiPropsV5 or {}
            local apiSuper = getgenv().__dexApiSuperclass or {}

            -- Build hidden properties map if gethiddenproperties exists
            local hiddenValues = {}
            if showHidden then
                pcall(function()
                    if gethiddenproperties then
                        local hProps = gethiddenproperties(target)
                        if hProps then
                            for _, hp in pairs(hProps) do
                                if type(hp) == "table" and hp.Name then
                                    hiddenValues[hp.Name] = hp.Value
                                elseif type(hp) == "string" then
                                    hiddenValues[hp] = true
                                end
                            end
                        end
                    end
                end)
            end

            -- Collect all valid properties by walking the class hierarchy
            local seen = {}
            local cn = target.ClassName
            while cn and cn ~= "" and cn ~= "<<<ROOT>>>" do
                local classProps = apiProps[cn]
                if classProps then
                    for _, propInfo in pairs(classProps) do
                        if not seen[propInfo.name] then
                            seen[propInfo.name] = true
                            -- Filter: skip hidden/NotScriptable unless showHidden is on
                            local isHiddenProp = propInfo.hidden or propInfo.notScriptable
                            if isHiddenProp and not showHidden then
                                -- skip this property
                            else
                                local valStr = ""
                                local propType = ""
                                local enumOpts = nil
                                pcall(function()
                                    local val = (target :: any)[propInfo.name]
                                    propType = typeof(val)
                                    if propType == "Instance" then
                                        local pathParts = {}
                                        local cur = val
                                        while cur and cur ~= game do
                                            table.insert(pathParts, 1, cur.Name)
                                            cur = cur.Parent
                                        end
                                        if #pathParts > 0 then
                                            valStr = "game." .. table.concat(pathParts, ".")
                                        else
                                            valStr = "game"
                                        end
                                    elseif propType == "EnumItem" then
                                        local items = val.EnumType:GetEnumItems()
                                        enumOpts = {}
                                        for _, item in pairs(items) do
                                            table.insert(enumOpts, item.Name)
                                        end
                                        valStr = val.Name
                                    else
                                        valStr = tostring(val)
                                    end
                                end)
                                -- If value empty and hidden, try hiddenValues
                                if valStr == "" and isHiddenProp and hiddenValues[propInfo.name] ~= nil then
                                    pcall(function()
                                        local hv = hiddenValues[propInfo.name]
                                        if hv ~= true then
                                            propType = typeof(hv)
                                            valStr = tostring(hv)
                                        end
                                    end)
                                end
                                local propEntry = {
                                    name = propInfo.name,
                                    value = valStr,
                                    type = propType,
                                    category = propInfo.category,
                                    readOnly = propInfo.readOnly,
                                    deprecated = propInfo.deprecated,
                                    valueType = propInfo.valueType,
                                    valueCategory = propInfo.valueCategory,
                                }
                                if isHiddenProp then propEntry.hidden = true end
                                if enumOpts then propEntry.enumOptions = enumOpts end
                                table.insert(properties, propEntry)
                            end
                        end
                    end
                end
                cn = apiSuper[cn]
            end

            -- Attributes
            pcall(function()
                local attrs = target:GetAttributes()
                for attrName, attrValue in pairs(attrs) do
                    table.insert(properties, {
                        name = attrName,
                        value = tostring(attrValue),
                        type = typeof(attrValue),
                        category = "Attributes",
                        readOnly = false,
                        valueType = typeof(attrValue),
                    })
                end
            end)

            -- Sort by category then name
            table.sort(properties, function(a, b)
                if a.category == b.category then
                    return a.name < b.name
                end
                return a.category < b.category
            end)

            wsSend({
                type = "dex_properties",
                requestId = requestId,
                path = path,
                properties = properties,
            })
        end)
    elseif data.type == "dex_watchProperties" then
        task.spawn(function()
            -- Disconnect any existing watch
            if getgenv().__dexPropWatchConn then
                pcall(function() getgenv().__dexPropWatchConn:Disconnect() end)
                getgenv().__dexPropWatchConn = nil
            end
            local path = data.path or ""
            if path == "" then return end
            
            -- Resolve instance (same logic as getProperties)
            local target = nil
            pcall(function()
                local rawParts = {}
                for part in string.gmatch(path, "[^%.]+") do
                    table.insert(rawParts, part)
                end
                target = game
                for i = 2, #rawParts do
                    local raw = rawParts[i]
                    local name = string.gsub(raw, "%[%d+%]$", "")
                    local idxStr = string.match(raw, "%[(%d+)%]$")
                    local idx = idxStr and tonumber(idxStr) or 1
                    local found = false
                    if i == 2 then
                        pcall(function()
                            target = cloneref(game:GetService(name))
                            found = true
                        end)
                    end
                    if not found then
                        local count = 0
                        local match = nil
                        for _, c in target:GetChildren() do
                            if c.Name == name then
                                count = count + 1
                                if count == idx then match = c; break end
                            end
                        end
                        target = match
                    end
                    if not target then return end
                end
            end)
            if not target then return end
            
            -- Helper to format a property value
            local function formatValue(val)
                local t = typeof(val)
                if t == "Instance" then
                    local pathParts = {}
                    local cur = val
                    while cur and cur ~= game do
                        table.insert(pathParts, 1, cur.Name)
                        cur = cur.Parent
                    end
                    return #pathParts > 0 and ("game." .. table.concat(pathParts, ".")) or "game", t
                elseif t == "EnumItem" then
                    return val.Name, t
                else
                    return tostring(val), t
                end
            end
            
            -- Connect Changed signal — fires for any property change
            local watchPath = path
            local conn = target.Changed:Connect(function(propName)
                pcall(function()
                    local val = (target :: any)[propName]
                    local valStr, propType = formatValue(val)
                    wsSend({
                        type = "dex_livePropertyUpdate",
                        path = watchPath,
                        propName = propName,
                        value = valStr,
                        propType = propType,
                    })
                end)
            end)
            getgenv().__dexPropWatchConn = conn
        end)
    elseif data.type == "dex_unwatchProperties" then
        if getgenv().__dexPropWatchConn then
            pcall(function() getgenv().__dexPropWatchConn:Disconnect() end)
            getgenv().__dexPropWatchConn = nil
        end
    elseif data.type == "dex_reparent" then
        task.spawn(function()
            local sourcePath = data.sourcePath or ""
            local destPath = data.destPath or ""
            local requestId = data.requestId or ""
            
            local function resolvePath(p)
                local inst = nil
                pcall(function()
                    local rawParts = {}
                    for part in string.gmatch(p, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    inst = game
                    for i = 2, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local found = false
                        if i == 2 then
                            pcall(function()
                                inst = cloneref(game:GetService(name))
                                found = true
                            end)
                        end
                        if not found then
                            local count = 0
                            local match = nil
                            for _, c in inst:GetChildren() do
                                if c.Name == name then
                                    count = count + 1
                                    if count == idx then match = c; break end
                                end
                            end
                            inst = match
                        end
                        if not inst then return end
                    end
                end)
                return inst
            end
            
            local source = resolvePath(sourcePath)
            local dest = resolvePath(destPath)
            
            if source and dest then
                local ok, err = pcall(function()
                    source.Parent = dest
                end)
                wsSend({
                    type = "dex_reparentResult",
                    requestId = requestId,
                    success = ok,
                    error = not ok and tostring(err) or nil,
                })
            else
                wsSend({
                    type = "dex_reparentResult",
                    requestId = requestId,
                    success = false,
                    error = "Could not resolve source or destination path",
                })
            end
        end)
    elseif data.type == "dex_setProperty" then
        task.spawn(function()
            local path = data.path or ""
            local propName = data.propName or ""
            local newValue = data.value
            local requestId = data.requestId or ""

            local success = false
            local errMsg = ""
            print("[DEX] setProperty: path=" .. path .. " prop=" .. propName .. " val=" .. tostring(newValue))

            -- Step 1: Resolve the target instance
            local target = nil
            local ok1, err1 = pcall(function()
                local rawParts = {}
                for part in string.gmatch(path, "[^%.]+") do
                    table.insert(rawParts, part)
                end
                local cur = game
                for i = 2, #rawParts do
                    local raw = rawParts[i]
                    local name = string.gsub(raw, "%[%d+%]$", "")
                    local idxStr = string.match(raw, "%[(%d+)%]$")
                    local idx = idxStr and tonumber(idxStr) or 1
                    local found = false
                    if i == 2 then
                        pcall(function()
                            cur = cloneref(game:GetService(name))
                            found = true
                        end)
                    end
                    if not found then
                        local count = 0
                        local match = nil
                        for _, c in cur:GetChildren() do
                            if c.Name == name then
                                count = count + 1
                                if count == idx then match = c; break end
                            end
                        end
                        if not match then error("Child not found: " .. raw) end
                        cur = match
                    end
                end
                target = cur
            end)

            if not ok1 or not target then
                wsSend({ type = "dex_setPropertyResult", requestId = requestId, success = false, error = "Resolve failed: " .. tostring(err1) })
                return
            end

            -- Step 2: Determine if property is instance-type via API dump
            local isInstanceType = false
            pcall(function()
                local apiProps = getgenv().__dexApiPropsV4
                local apiSuper = getgenv().__dexApiSuperclass
                if apiProps then
                    local cn = target.ClassName
                    while cn do
                        local classProps = apiProps[cn]
                        if classProps then
                            for _, p in ipairs(classProps) do
                                if p.name == propName and p.valueCategory == "Class" then
                                    isInstanceType = true
                                    break
                                end
                            end
                        end
                        if isInstanceType then break end
                        cn = apiSuper and apiSuper[cn] or nil
                    end
                end
            end)

            -- Step 3: Coerce and set
            local ok2, err2 = pcall(function()
                local currentVal = (target :: any)[propName]
                local valType = typeof(currentVal)
                print("[DEX] valType=" .. valType .. " isInstanceType=" .. tostring(isInstanceType))

                local coerced = newValue
                if valType == "boolean" then
                    coerced = (newValue == "true" or newValue == "True" or newValue == "1")
                elseif valType == "number" then
                    coerced = tonumber(newValue) or 0
                elseif valType == "string" then
                    coerced = tostring(newValue)
                elseif valType == "Vector3" then
                    local x, y, z = string.match(newValue, "([%d%.%-]+),%s*([%d%.%-]+),%s*([%d%.%-]+)")
                    coerced = Vector3.new(tonumber(x) or 0, tonumber(y) or 0, tonumber(z) or 0)
                elseif valType == "Vector2" then
                    local x, y = string.match(newValue, "([%d%.%-]+),%s*([%d%.%-]+)")
                    coerced = Vector2.new(tonumber(x) or 0, tonumber(y) or 0)
                elseif valType == "Color3" then
                    local r, g, b = string.match(newValue, "([%d%.%-]+),%s*([%d%.%-]+),%s*([%d%.%-]+)")
                    coerced = Color3.new(tonumber(r) or 0, tonumber(g) or 0, tonumber(b) or 0)
                elseif valType == "BrickColor" then
                    coerced = BrickColor.new(newValue)
                elseif valType == "UDim2" then
                    local xs, xo, ys, yo = string.match(newValue, "([%d%.%-]+),%s*([%d%.%-]+),%s*([%d%.%-]+),%s*([%d%.%-]+)")
                    coerced = UDim2.new(tonumber(xs) or 0, tonumber(xo) or 0, tonumber(ys) or 0, tonumber(yo) or 0)
                elseif valType == "CFrame" then
                    local vals = {}
                    for v in string.gmatch(newValue .. ",", "([^,]+),") do
                        local trimmed = v:match("^%s*(.-)%s*$")
                        table.insert(vals, tonumber(trimmed) or 0)
                    end
                    if #vals >= 12 then
                        coerced = CFrame.new(vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], vals[7], vals[8], vals[9], vals[10], vals[11], vals[12])
                    elseif #vals >= 3 then
                        coerced = CFrame.new(vals[1], vals[2], vals[3])
                    else
                        error("CFrame needs at least 3 values, got " .. #vals .. " from: " .. newValue)
                    end
                elseif valType == "EnumItem" then
                    local enumPath = newValue
                    if not string.find(enumPath, "Enum.") then
                        enumPath = tostring(currentVal.EnumType) .. "." .. newValue
                    end
                    local parts2 = {}
                    for p in string.gmatch(enumPath, "[^%.]+") do
                        table.insert(parts2, p)
                    end
                    local e = Enum
                    for i = 2, #parts2 do
                        e = (e :: any)[parts2[i]]
                    end
                    coerced = e
                end

                -- Instance-type properties: resolve path to instance
                if isInstanceType or valType == "Instance" then
                    print("[DEX] Resolving instance path: " .. tostring(newValue))
                    local pathParts2 = {}
                    for p in string.gmatch(newValue, "[^%.]+") do
                        table.insert(pathParts2, p)
                    end
                    local cur = game
                    for i2 = 2, #pathParts2 do
                        local raw2 = pathParts2[i2]
                        local name2 = string.gsub(raw2, "%[%d+%]$", "")
                        local idxStr2 = string.match(raw2, "%[(%d+)%]$")
                        local idx2 = idxStr2 and tonumber(idxStr2) or 1
                        local found2 = false
                        if i2 == 2 then
                            pcall(function()
                                cur = cloneref(game:GetService(name2))
                                found2 = true
                            end)
                        end
                        if not found2 then
                            local count2 = 0
                            local match2 = nil
                            for _, c in cur:GetChildren() do
                                if c.Name == name2 then
                                    count2 = count2 + 1
                                    if count2 == idx2 then match2 = c; break end
                                end
                            end
                            if not match2 then error("Instance child not found: " .. raw2) end
                            cur = match2
                        end
                    end
                    coerced = cur
                end

                print("[DEX] Setting " .. propName .. " = " .. tostring(coerced) .. " (" .. typeof(coerced) .. ")");
                (target :: any)[propName] = coerced
                success = true
            end)

            if not success then
                errMsg = "Set failed: " .. tostring(err2)
            end

            wsSend({
                type = "dex_setPropertyResult",
                requestId = requestId,
                success = success,
                error = errMsg,
            })
        end)
    elseif data.type == "dex_search" then
        task.spawn(function()
            local query = data.query or ""
            local requestId = data.requestId or ""
            local results = {}

            if #query >= 2 then
                local queryLower = string.lower(query)
                local count = 0
                local maxResults = 100

                local function searchIn(inst, currentPath, parentClasses)
                    if count >= maxResults then return end
                    local ok, kids = pcall(function() return inst:GetChildren() end)
                    if not ok or not kids then return end
                    -- Pre-compute name counts for sibling disambiguation
                    local nameCounts = {}
                    local nameIndices = {}
                    for _, child in kids do
                        local nm = child.Name
                        nameCounts[nm] = (nameCounts[nm] or 0) + 1
                    end
                    for _, child in kids do
                        if count >= maxResults then return end
                        local nm = child.Name
                        nameIndices[nm] = (nameIndices[nm] or 0) + 1
                        local idx = nameIndices[nm]
                        local childPath = currentPath .. "." .. nm
                        -- When there are duplicates, append bracket index
                        if nameCounts[nm] > 1 then
                            childPath = childPath .. "[" .. tostring(idx) .. "]"
                        end
                        -- Build child's parent classes array (append this child's class)
                        local childParentClasses = {}
                        for i, c in ipairs(parentClasses) do
                            childParentClasses[i] = c
                        end
                        table.insert(childParentClasses, child.ClassName)
                        if string.find(string.lower(nm), queryLower, 1, true) then
                            local hasKids = false
                            pcall(function() hasKids = #child:GetChildren() > 0 end)
                            table.insert(results, {
                                name = nm,
                                className = child.ClassName,
                                path = childPath,
                                hasChildren = hasKids,
                                parentClasses = childParentClasses,
                            })
                            count = count + 1
                        end
                        searchIn(child, childPath, childParentClasses)
                    end
                end

                -- Search key services
                local searchServices = {"Workspace", "Players", "ReplicatedStorage", "ReplicatedFirst", "StarterGui", "StarterPack", "StarterPlayer", "Lighting", "SoundService"}
                for _, svcName in searchServices do
                    pcall(function()
                        local svc = cloneref(game:GetService(svcName))
                        local svcPath = "game." .. svcName
                        searchIn(svc, svcPath, {svc.ClassName})
                    end)
                end
            end

            wsSend({
                type = "dex_search",
                requestId = requestId,
                results = results,
            })
        end)
    elseif data.type == "dex_resolveClasses" then
        -- Resolve classNames for a batch of paths
        task.spawn(function()
            local paths = data.paths or {}
            local requestId = data.requestId or ""
            local result = {}
            for _, path in ipairs(paths) do
                local segs = string.split(path, ".")
                local current = game
                local resolved = false
                for i = 2, #segs do
                    local segName = segs[i]
                    -- Strip [index] if present
                    local baseName = string.match(segName, "^(.+)%[%d+%]$") or segName
                    local idx = tonumber(string.match(segName, "%[(%d+)%]$")) or 1
                    local ok, children = pcall(function() return current:GetChildren() end)
                    if not ok or not children then break end
                    -- Find the Nth child with this name
                    local count = 0
                    local found = nil
                    for _, child in ipairs(children) do
                        if child.Name == baseName then
                            count = count + 1
                            if count == idx then
                                found = child
                                break
                            end
                        end
                    end
                    if found then
                        current = found
                        if i == #segs then
                            result[path] = current.ClassName
                            resolved = true
                        end
                    else
                        break
                    end
                end
                if not resolved then
                    -- Try GetService for depth-1
                    if #segs == 2 then
                        pcall(function()
                            result[path] = game:GetService(segs[2]).ClassName
                        end)
                    end
                end
            end
            wsSend({
                type = "dex_resolveClasses",
                requestId = requestId,
                classes = result,
            })
        end)
    elseif data.type == "dex_enableLive" then
        -- Enable/disable live tree updates via DescendantAdded/Removing
        -- Always clean up old connections first
        if getgenv().__dexLiveConns then
            for _, conn in getgenv().__dexLiveConns do
                pcall(function() conn:Disconnect() end)
            end
            getgenv().__dexLiveConns = nil
        end
        if data.enabled then
            print("[DEX] Enabling live tree updates")
            -- Helper: build path for an instance
            local function buildPath(inst)
                local parts = {}
                local cur = inst
                while cur and cur ~= game do
                    table.insert(parts, 1, cur.Name)
                    cur = cur.Parent
                end
                if #parts > 0 then return "game." .. table.concat(parts, ".") end
                return "game"
            end
            -- Debounce: collect changed parent paths and batch-send
            local pendingPaths = {}
            local debounceRunning = false
            local function queueUpdate(parentPath)
                pendingPaths[parentPath] = true
                if debounceRunning then return end
                debounceRunning = true
                task.delay(0.15, function()
                    debounceRunning = false
                    local paths = {}
                    for p in pairs(pendingPaths) do
                        table.insert(paths, p)
                    end
                    pendingPaths = {}
                    if #paths > 0 then
                        print("[DEX] Live update sending paths: " .. table.concat(paths, ", "))
                        wsSend({ type = "dex_liveUpdate", paths = paths })
                    end
                end)
            end
            local c1 = game.DescendantAdded:Connect(function(obj)
                pcall(function()
                    local parent = obj.Parent
                    if parent then queueUpdate(buildPath(parent)) end
                end)
            end)
            local c2 = game.DescendantRemoving:Connect(function(obj)
                pcall(function()
                    local parent = obj.Parent
                    if parent then queueUpdate(buildPath(parent)) end
                end)
            end)
            getgenv().__dexLiveConns = {c1, c2}
            print("[DEX] Live tree connections active")
        else
            print("[DEX] Disabled live tree updates")
        end
    elseif data.type == "dex_destroy" then
        task.spawn(function()
            local path = data.path or ""
            local requestId = data.requestId or ""
            local function resolvePath(p)
                local inst = nil
                pcall(function()
                    local rawParts = {}
                    for part in string.gmatch(p, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    inst = game
                    for i = 2, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local found = false
                        if i == 2 then
                            pcall(function()
                                inst = cloneref(game:GetService(name))
                                found = true
                            end)
                        end
                        if not found then
                            local count = 0
                            local match = nil
                            for _, c in inst:GetChildren() do
                                if c.Name == name then
                                    count = count + 1
                                    if count == idx then match = c; break end
                                end
                            end
                            inst = match
                        end
                        if not inst then return end
                    end
                end)
                return inst
            end
            local target = resolvePath(path)
            if target then
                local ok, err = pcall(function() target:Destroy() end)
                wsSend({ type = "dex_destroyResult", requestId = requestId, success = ok, error = not ok and tostring(err) or nil })
            else
                wsSend({ type = "dex_destroyResult", requestId = requestId, success = false, error = "Could not resolve path" })
            end
        end)
    elseif data.type == "dex_cut" then
        task.spawn(function()
            local path = data.path or ""
            local requestId = data.requestId or ""
            local function resolvePath(p)
                local inst = nil
                pcall(function()
                    local rawParts = {}
                    for part in string.gmatch(p, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    inst = game
                    for i = 2, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local found = false
                        if i == 2 then
                            pcall(function()
                                inst = cloneref(game:GetService(name))
                                found = true
                            end)
                        end
                        if not found then
                            local count = 0
                            local match = nil
                            for _, c in inst:GetChildren() do
                                if c.Name == name then
                                    count = count + 1
                                    if count == idx then match = c; break end
                                end
                            end
                            inst = match
                        end
                        if not inst then return end
                    end
                end)
                return inst
            end
            local source = resolvePath(path)
            if source then
                local ok, err = pcall(function()
                    local rs = game:GetService("ReplicatedStorage")
                    local container = rs:FindFirstChild("__dexCutClip")
                    if container then container:Destroy() end
                    container = Instance.new("Folder")
                    container.Name = "__dexCutClip"
                    container.Parent = rs
                    local clone = source:Clone()
                    clone.Parent = container
                    source:Destroy()
                end)
                wsSend({ type = "dex_cutResult", requestId = requestId, success = ok, error = not ok and tostring(err) or nil })
            else
                wsSend({ type = "dex_cutResult", requestId = requestId, success = false, error = "Could not resolve path" })
            end
        end)
    elseif data.type == "dex_pasteFromCut" then
        task.spawn(function()
            local destPath = data.destPath or ""
            local requestId = data.requestId or ""
            local function resolvePath(p)
                local inst = nil
                pcall(function()
                    local rawParts = {}
                    for part in string.gmatch(p, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    inst = game
                    for i = 2, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local found = false
                        if i == 2 then
                            pcall(function()
                                inst = cloneref(game:GetService(name))
                                found = true
                            end)
                        end
                        if not found then
                            local count = 0
                            local match = nil
                            for _, c in inst:GetChildren() do
                                if c.Name == name then
                                    count = count + 1
                                    if count == idx then match = c; break end
                                end
                            end
                            inst = match
                        end
                        if not inst then return end
                    end
                end)
                return inst
            end
            local dest = resolvePath(destPath)
            if dest then
                local ok, err = pcall(function()
                    local rs = game:GetService("ReplicatedStorage")
                    local container = rs:FindFirstChild("__dexCutClip")
                    if not container then error("No cut data found") end
                    for _, child in container:GetChildren() do
                        child.Parent = dest
                    end
                    container:Destroy()
                end)
                wsSend({ type = "dex_pasteFromCutResult", requestId = requestId, success = ok, error = not ok and tostring(err) or nil })
            else
                wsSend({ type = "dex_pasteFromCutResult", requestId = requestId, success = false, error = "Could not resolve dest" })
            end
        end)
    elseif data.type == "dex_clone" then
        task.spawn(function()
            local sourcePath = data.sourcePath or ""
            local destPath = data.destPath or ""
            local requestId = data.requestId or ""
            local function resolvePath(p)
                local inst = nil
                pcall(function()
                    local rawParts = {}
                    for part in string.gmatch(p, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    inst = game
                    for i = 2, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local found = false
                        if i == 2 then
                            pcall(function()
                                inst = cloneref(game:GetService(name))
                                found = true
                            end)
                        end
                        if not found then
                            local count = 0
                            local match = nil
                            for _, c in inst:GetChildren() do
                                if c.Name == name then
                                    count = count + 1
                                    if count == idx then match = c; break end
                                end
                            end
                            inst = match
                        end
                        if not inst then return end
                    end
                end)
                return inst
            end
            local source = resolvePath(sourcePath)
            local dest = resolvePath(destPath)
            if source and dest then
                local ok, err = pcall(function()
                    local clone = source:Clone()
                    clone.Parent = dest
                end)
                wsSend({ type = "dex_cloneResult", requestId = requestId, success = ok, error = not ok and tostring(err) or nil })
            else
                wsSend({ type = "dex_cloneResult", requestId = requestId, success = false, error = "Could not resolve source or dest" })
            end
        end)
    elseif data.type == "dex_insertObject" then
        task.spawn(function()
            local parentPath = data.parentPath or ""
            local className = data.className or ""
            local requestId = data.requestId or ""
            local function resolvePath(p)
                local inst = nil
                pcall(function()
                    local rawParts = {}
                    for part in string.gmatch(p, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    inst = game
                    for i = 2, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local found = false
                        if i == 2 then
                            pcall(function()
                                inst = cloneref(game:GetService(name))
                                found = true
                            end)
                        end
                        if not found then
                            local count = 0
                            local match = nil
                            for _, c in inst:GetChildren() do
                                if c.Name == name then
                                    count = count + 1
                                    if count == idx then match = c; break end
                                end
                            end
                            inst = match
                        end
                        if not inst then return end
                    end
                end)
                return inst
            end
            local parent = resolvePath(parentPath)
            if parent and className ~= "" then
                local ok, err = pcall(function()
                    local inst = Instance.new(className)
                    inst.Parent = parent
                end)
                wsSend({ type = "dex_insertObjectResult", requestId = requestId, success = ok, error = not ok and tostring(err) or nil })
            else
                wsSend({ type = "dex_insertObjectResult", requestId = requestId, success = false, error = "Could not resolve parent or missing className" })
            end
        end)
    elseif data.type == "dex_decompile" then
        task.spawn(function()
            local path = data.path or ""
            local requestId = data.requestId or ""

            -- Resolve instance (supports nil. paths and game. paths)
            local target = nil
            pcall(function()
                if string.sub(path, 1, 4) == "nil." then
                    local rawParts = {}
                    for part in string.gmatch(path, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    local rootDebugId = rawParts[2]
                    if not rootDebugId or not getnilinstances then return end
                    for _, obj in getnilinstances() do
                        local did = ""
                        pcall(function() did = obj:GetDebugId() end)
                        if did == rootDebugId then target = obj; break end
                    end
                    if not target then return end
                    for i = 3, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local count = 0
                        local match = nil
                        for _, c in target:GetChildren() do
                            if c.Name == name then
                                count = count + 1
                                if count == idx then match = c; break end
                            end
                        end
                        target = match
                        if not target then return end
                    end
                else
                    local rawParts = {}
                    for part in string.gmatch(path, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    target = game
                    for i = 2, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local found = false
                        if i == 2 then
                            pcall(function()
                                target = cloneref(game:GetService(name))
                                found = true
                            end)
                        end
                        if not found then
                            local count = 0
                            local match = nil
                            for _, c in target:GetChildren() do
                                if c.Name == name then
                                    count = count + 1
                                    if count == idx then match = c; break end
                                end
                            end
                            target = match
                        end
                        if not target then return end
                    end
                end
            end)

            if not target then
                wsSend({ type = "dex_decompileResult", requestId = requestId, success = false, source = "-- Could not resolve script instance", scriptName = "", fullName = "" })
                return
            end

            local scriptName = ""
            local fullName = ""
            pcall(function() scriptName = target.Name end)
            pcall(function() fullName = target:GetFullName() end)

            -- Base64 encoding
            local b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
            local function base64_encode(input)
                return ((input:gsub('.', function(x)
                    local r, byte = '', x:byte()
                    for i = 8, 1, -1 do r = r .. (byte % 2^i - byte % 2^(i-1) > 0 and '1' or '0') end
                    return r
                end) .. '0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
                    if (#x < 6) then return '' end
                    local c = 0
                    for i = 1, 6 do c = c + (x:sub(i, i) == '1' and 2^(6-i) or 0) end
                    return b64chars:sub(c+1, c+1)
                end) .. ({ '', '==', '=' })[#input % 3 + 1])
            end

            -- Get bytecode
            local okBytecode, bytecode = pcall(getscriptbytecode, target)
            if not okBytecode then
                wsSend({ type = "dex_decompileResult", requestId = requestId, success = false, source = "-- Failed to get script bytecode, error:\n\n--[[\n" .. tostring(bytecode) .. "\n--]]", scriptName = scriptName, fullName = fullName })
                return
            end

            -- Send to decompile API
            local okRequest, httpResult = pcall(request, {
                Url = "https://medal.upio.dev/decompile",
                Method = "POST",
                Body = base64_encode(bytecode),
                Headers = {
                    ["Content-Type"] = "text/plain"
                },
            })

            if not okRequest then
                wsSend({ type = "dex_decompileResult", requestId = requestId, success = false, source = "-- Failed to decompile, error:\n\n--[[\n" .. tostring(httpResult) .. "\n--]]", scriptName = scriptName, fullName = fullName })
                return
            end

            if httpResult.StatusCode ~= 200 then
                wsSend({ type = "dex_decompileResult", requestId = requestId, success = false, source = "-- Error occurred while requesting the API, error:\n\n--[[\n" .. tostring(httpResult.Body) .. "\n--]]", scriptName = scriptName, fullName = fullName })
                return
            end

            local source = string.gsub(httpResult.Body, string.char(0x00CD), " ")
            wsSend({ type = "dex_decompileResult", requestId = requestId, success = true, source = source, scriptName = scriptName, fullName = fullName })
        end)
    elseif data.type == "dex_dumpFunctions" then
        task.spawn(function()
            local path = data.path or ""
            local requestId = data.requestId or ""

            -- Resolve instance (same as dex_decompile)
            local target = nil
            pcall(function()
                if string.sub(path, 1, 4) == "nil." then
                    local rawParts = {}
                    for part in string.gmatch(path, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    local rootDebugId = rawParts[2]
                    if not rootDebugId or not getnilinstances then return end
                    for _, obj in getnilinstances() do
                        local did = ""
                        pcall(function() did = obj:GetDebugId() end)
                        if did == rootDebugId then target = obj; break end
                    end
                    if not target then return end
                    for i = 3, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local count = 0
                        local match = nil
                        for _, c in target:GetChildren() do
                            if c.Name == name then
                                count = count + 1
                                if count == idx then match = c; break end
                            end
                        end
                        target = match
                        if not target then return end
                    end
                else
                    local rawParts = {}
                    for part in string.gmatch(path, "[^%.]+") do
                        table.insert(rawParts, part)
                    end
                    target = game
                    for i = 2, #rawParts do
                        local raw = rawParts[i]
                        local name = string.gsub(raw, "%[%d+%]$", "")
                        local idxStr = string.match(raw, "%[(%d+)%]$")
                        local idx = idxStr and tonumber(idxStr) or 1
                        local found = false
                        if i == 2 then
                            pcall(function()
                                target = cloneref(game:GetService(name))
                                found = true
                            end)
                        end
                        if not found then
                            local count = 0
                            local match = nil
                            for _, c in target:GetChildren() do
                                if c.Name == name then
                                    count = count + 1
                                    if count == idx then match = c; break end
                                end
                            end
                            target = match
                        end
                        if not target then return end
                    end
                end
            end)

            if not target then
                wsSend({ type = "dex_dumpFunctionsResult", requestId = requestId, success = false, dump = "-- Could not resolve script instance" })
                return
            end

            local ok, dumpResult = pcall(function()
                local _getgc = getgc or get_gc_objects
                local _getupvalues = (debug and debug.getupvalues) or getupvalues or getupvals
                local _getconstants = (debug and debug.getconstants) or getconstants or getconsts
                local _getinfo = (debug and (debug.getinfo or debug.info)) or getinfo

                local original = ("\n-- // Function Dumper made by King.Kevin\n-- // Script Path: %s\n\n--[["):format(target:GetFullName())
                local dump = original
                local data_base = {}

                local functions = {}
                function functions:add_to_dump(str, indentation, newLine)
                    newLine = newLine == nil and true or newLine
                    dump = dump .. ("%s%s%s"):format(string.rep("\t\t", indentation), tostring(str), newLine and "\n" or "")
                end
                function functions:get_function_name(func)
                    local n = _getinfo(func).name
                    return n ~= "" and n or "Unknown Name"
                end
                function functions:dump_table(input, indent, index)
                    indent = indent < 0 and 0 or indent
                    functions:add_to_dump(("%s [%s] %s"):format(tostring(index), tostring(typeof(input)), tostring(input)), indent - 1)
                    local count = 0
                    for idx, value in pairs(input) do
                        count = count + 1
                        if type(value) == "function" then
                            functions:add_to_dump(("%d [function] = %s"):format(count, functions:get_function_name(value)), indent)
                        elseif type(value) == "table" then
                            if not data_base[value] then
                                data_base[value] = true
                                functions:add_to_dump(("%d [table]:"):format(count), indent)
                                functions:dump_table(value, indent + 1, idx)
                            else
                                functions:add_to_dump(("%d [table] (Recursive table detected)"):format(count), indent)
                            end
                        else
                            functions:add_to_dump(("%d [%s] = %s"):format(count, tostring(typeof(value)), tostring(value)), indent)
                        end
                    end
                end
                function functions:dump_function(input, indent)
                    functions:add_to_dump(("\nFunction Dump: %s"):format(functions:get_function_name(input)), indent)
                    functions:add_to_dump(("\nFunction Upvalues: %s"):format(functions:get_function_name(input)), indent)
                    for index, upvalue in pairs(_getupvalues(input)) do
                        if type(upvalue) == "function" then
                            functions:add_to_dump(("%d [function] = %s"):format(index, functions:get_function_name(upvalue)), indent + 1)
                        elseif type(upvalue) == "table" then
                            if not data_base[upvalue] then
                                data_base[upvalue] = true
                                functions:add_to_dump(("%d [table]:"):format(index), indent + 1)
                                functions:dump_table(upvalue, indent + 2, index)
                            else
                                functions:add_to_dump(("%d [table] (Recursive table detected)"):format(index), indent + 1)
                            end
                        else
                            functions:add_to_dump(("%d [%s] = %s"):format(index, tostring(typeof(upvalue)), tostring(upvalue)), indent + 1)
                        end
                    end
                    functions:add_to_dump(("\nFunction Constants: %s"):format(functions:get_function_name(input)), indent)
                    for index, constant in pairs(_getconstants(input)) do
                        if type(constant) == "function" then
                            functions:add_to_dump(("%d [function] = %s"):format(index, functions:get_function_name(constant)), indent + 1)
                        elseif type(constant) == "table" then
                            if not data_base[constant] then
                                data_base[constant] = true
                                functions:add_to_dump(("%d [table]:"):format(index), indent + 1)
                                functions:dump_table(constant, indent + 2, index)
                            else
                                functions:add_to_dump(("%d [table] (Recursive table detected)"):format(index), indent + 1)
                            end
                        else
                            functions:add_to_dump(("%d [%s] = %s"):format(index, tostring(typeof(constant)), tostring(constant)), indent + 1)
                        end
                    end
                end

                for _, _function in pairs(_getgc()) do
                    if typeof(_function) == "function" and getfenv(_function).script and getfenv(_function).script == target then
                        functions:dump_function(_function, 0)
                        functions:add_to_dump("\n" .. ("="):rep(100), 0, false)
                    end
                end

                if dump ~= original then
                    return dump .. "]]"
                else
                    return "-- No functions found for this script"
                end
            end)

            wsSend({ type = "dex_dumpFunctionsResult", requestId = requestId, success = ok, dump = ok and dumpResult or ("-- Dump failed: " .. tostring(dumpResult)) })
        end)
    end
end

local function connect()
    local ok = pcall(function()
        ws = WebSocket.connect(WS_URL)
        connected = true
        getgenv().__3itx_ws = ws
        getgenv().__3itx_connected = true
        ws:Send(info)
        ws.OnMessage:Connect(onMessage)

        -- Set up live tree update listeners (DescendantAdded/Removing)
        -- Wrapped in pcall so failures don't break WS setup
        local liveOk, liveErr = pcall(function()
            -- Clean up old connections first
            if getgenv().__dexLiveConns then
                for _, conn in getgenv().__dexLiveConns do
                    pcall(function() conn:Disconnect() end)
                end
            end
            local function buildPath(inst)
                local parts = {}
                local cur = inst
                while cur and cur ~= game do
                    table.insert(parts, 1, cur.Name)
                    cur = cur.Parent
                end
                if #parts > 0 then return "game." .. table.concat(parts, ".") end
                return "game"
            end
            local pendingEvents = {}
            local flushScheduled = false
            local function scheduleFlush()
                if flushScheduled then return end
                flushScheduled = true
                task.delay(0.05, function()
                    flushScheduled = false
                    local events = pendingEvents
                    pendingEvents = {}
                    if #events > 0 then
                        wsSend({ type = "dex_liveEvents", events = events })
                    end
                end)
            end
            -- Hybrid approach:
            -- 1. game.DescendantAdded for truly new instances (joining DataModel)
            -- 2. ChildAdded/ChildRemoved on services + their immediate children
            --    for re-parenting detection (DescendantAdded doesn't fire for re-parenting)
            local allConns = {}
            local watchedPaths = {} -- track what we've connected to avoid duplicates
            local watchCount = 0
            
            local function watchChildEvents(inst)
                local instPath = buildPath(inst)
                if watchedPaths[instPath] then return end
                watchedPaths[instPath] = true
                watchCount = watchCount + 1
                
                local c1 = inst.ChildAdded:Connect(function(child)
                    task.spawn(function()
                        task.wait()
                        pcall(function()
                            if not child or not child.Parent then return end
                            local hasChildren = false
                            pcall(function() hasChildren = #child:GetChildren() > 0 end)
                            table.insert(pendingEvents, {
                                action = "add",
                                parentPath = instPath,
                                name = child.Name,
                                className = child.ClassName,
                                hasChildren = hasChildren,
                            })
                            scheduleFlush()
                        end)
                    end)
                end)
                -- Use ChildRemoved (fires after removal) instead of ChildRemoving
                -- Some executors may not support ChildRemoving
                local c2 = inst.ChildRemoved:Connect(function(child)
                    pcall(function()
                        if not child then return end
                        table.insert(pendingEvents, {
                            action = "remove",
                            parentPath = instPath,
                            name = child.Name,
                        })
                        scheduleFlush()
                    end)
                end)
                table.insert(allConns, c1)
                table.insert(allConns, c2)
            end
            
            -- Watch Workspace recursively (need deep nesting for map.tower etc)
            -- For other services, watch service + direct children
            local samplePaths = {}
            local sampleCount = 0
            
            -- Recursively watch an instance and all its children
            local function watchRecursive(inst, depth)
                watchChildEvents(inst)
                if sampleCount < 5 then
                    sampleCount = sampleCount + 1
                    table.insert(samplePaths, buildPath(inst))
                end
                if depth > 8 then return end -- safety limit
                pcall(function()
                    for _, child in inst:GetChildren() do
                        pcall(function()
                            -- Skip player characters (Models with Humanoid) to avoid performance issues
                            local isCharacter = false
                            pcall(function()
                                isCharacter = child:IsA("Model") and child:FindFirstChildOfClass("Humanoid") ~= nil
                            end)
                            if not isCharacter then
                                watchRecursive(child, depth + 1)
                            else
                                -- Still watch the character itself (for direct children) but don't recurse
                                watchChildEvents(child)
                            end
                        end)
                    end
                end)
                -- Dynamically watch new children
                local c = inst.ChildAdded:Connect(function(newChild)
                    task.spawn(function()
                        task.wait()
                        pcall(function()
                            if newChild and newChild.Parent then
                                watchRecursive(newChild, depth + 1)
                            end
                        end)
                    end)
                end)
                table.insert(allConns, c)
            end
            
            -- Deep-watch Workspace
            pcall(function()
                local ws = game:GetService("Workspace")
                if ws then watchRecursive(ws, 1) end
            end)
            
            -- Shallow-watch other services (service + direct children)
            local otherServices = {"Players", "ReplicatedStorage", "ReplicatedFirst",
                "Lighting", "SoundService"}
            for _, svcName in otherServices do
                pcall(function()
                    local svc = game:GetService(svcName)
                    if not svc then return end
                    watchChildEvents(svc)
                    for _, child in svc:GetChildren() do
                        pcall(function() watchChildEvents(child) end)
                    end
                    local c = svc.ChildAdded:Connect(function(newChild)
                        pcall(function() watchChildEvents(newChild) end)
                    end)
                    table.insert(allConns, c)
                end)
            end

            
            -- Also use game.DescendantAdded as fallback for deeply nested new instances
            local c_desc = game.DescendantAdded:Connect(function(obj)
                task.spawn(function()
                    task.wait()
                    pcall(function()
                        if not obj or not obj.Parent then return end
                        local hasChildren = false
                        pcall(function() hasChildren = #obj:GetChildren() > 0 end)
                        table.insert(pendingEvents, {
                            action = "add",
                            parentPath = buildPath(obj.Parent),
                            name = obj.Name,
                            className = obj.ClassName,
                            hasChildren = hasChildren,
                        })
                        scheduleFlush()
                    end)
                end)
            end)
            table.insert(allConns, c_desc)
            
            getgenv().__dexLiveConns = allConns
        end)
        if not liveOk then
            sendLog("error", "[DEX-LIVE] Setup failed: " .. tostring(liveErr))
        end

        ws.OnClose:Connect(function()
            connected = false
            ws = nil
            getgenv().__3itx_ws = nil
            getgenv().__3itx_connected = false
            -- Disconnect live tree listeners
            if getgenv().__dexLiveConns then
                for _, conn in getgenv().__dexLiveConns do
                    pcall(function() conn:Disconnect() end)
                end
                getgenv().__dexLiveConns = nil
            end
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
        getgenv().__3itx_ws = nil
        getgenv().__3itx_connected = false
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
