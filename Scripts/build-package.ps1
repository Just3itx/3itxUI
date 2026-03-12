# Build & Package Script for 3itx UI
# Creates Launcher.zip with the necessary files for distribution

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

Write-Host "`n=== 3itx UI Build & Package ===" -ForegroundColor Cyan

# 1. Build C# launcher
Write-Host "`n[1/4] Building launcher..." -ForegroundColor Yellow
Push-Location "$root\3itx-launcher"
dotnet publish -c Release -o "$root\3itx-launcher\bin\publish"
Pop-Location
Write-Host "  Done" -ForegroundColor Green

# 2. Build installer
Write-Host "`n[2/4] Building installer..." -ForegroundColor Yellow
Push-Location "$root\3itx-installer"
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o "$root\dist\installer"
Pop-Location
Write-Host "  Done" -ForegroundColor Green

# 3. Stage files for Launcher.zip
Write-Host "`n[3/4] Staging files..." -ForegroundColor Yellow
$stage = "$root\dist\staging"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# Copy launcher exe and ALL DLLs (avoids missing dependencies)
$publishDir = "$root\3itx-launcher\bin\publish"
Copy-Item "$publishDir\3itx.exe" "$stage\" -Force
Copy-Item "$publishDir\3itx.dll" "$stage\" -Force
Copy-Item "$publishDir\3itx.deps.json" "$stage\" -Force
Copy-Item "$publishDir\3itx.runtimeconfig.json" "$stage\" -Force
Get-ChildItem "$publishDir\*.dll" | ForEach-Object {
    Copy-Item $_.FullName "$stage\" -Force
}
if (Test-Path "$publishDir\runtimes") {
    Copy-Item "$publishDir\runtimes" "$stage\runtimes" -Recurse -Force
}

# Copy Resources
if (Test-Path "$publishDir\Resources") {
    Copy-Item "$publishDir\Resources" "$stage\Resources" -Recurse -Force
}

# Copy 3itx-ui source (without node_modules, .next, .git)
$uiSrc = "$root\3itx-ui"
$uiDst = "$stage\3itx-ui"
New-Item -ItemType Directory -Path $uiDst -Force | Out-Null

# Copy essential UI files
$essentialDirs = @("src", "public")
$essentialFiles = @(
    "package.json", "package-lock.json", "tsconfig.json",
    "next.config.ts", "postcss.config.mjs", "tailwind.config.ts",
    "next-env.d.ts", "components.json"
)

foreach ($dir in $essentialDirs) {
    if (Test-Path "$uiSrc\$dir") {
        Copy-Item "$uiSrc\$dir" "$uiDst\$dir" -Recurse -Force
    }
}
foreach ($file in $essentialFiles) {
    if (Test-Path "$uiSrc\$file") {
        Copy-Item "$uiSrc\$file" "$uiDst\$file" -Force
    }
}

Write-Host "  Done" -ForegroundColor Green

# 4. Create zip
Write-Host "`n[4/4] Creating Launcher.zip..." -ForegroundColor Yellow
$zipPath = "$root\dist\Launcher.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$stage\*" -DestinationPath $zipPath
$size = (Get-Item $zipPath).Length / 1MB
Write-Host "  Launcher.zip created ($([math]::Round($size, 1)) MB)" -ForegroundColor Green

Write-Host "`n=== Build Complete ===" -ForegroundColor Cyan
Write-Host "  Launcher.zip: $zipPath"
Write-Host "  Installer:    $root\dist\installer\3itx-installer.exe"
Write-Host ""
