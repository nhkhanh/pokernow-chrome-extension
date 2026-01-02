# Build script for PokerNow Chrome Extension
# Creates a zip file for Chrome Web Store publishing

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extensionDir = Join-Path $scriptDir "extension"
$distDir = Join-Path $scriptDir "dist"

# Read version from manifest.json
$manifestPath = Join-Path $extensionDir "manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

Write-Host "Building PokerNow Extension v$version..." -ForegroundColor Cyan

# Create dist directory if it doesn't exist
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
    Write-Host "Created dist directory"
}

# Output zip file path
$zipFileName = "pokernow-extension-v$version.zip"
$zipPath = Join-Path $distDir $zipFileName

# Remove existing zip if it exists
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
    Write-Host "Removed existing $zipFileName"
}

# Create the zip file
Write-Host "Creating $zipFileName..."
Compress-Archive -Path "$extensionDir\*" -DestinationPath $zipPath -Force

# Get file size
$zipSize = (Get-Item $zipPath).Length
$zipSizeKB = [math]::Round($zipSize / 1024, 2)

Write-Host ""
Write-Host "Build complete!" -ForegroundColor Green
Write-Host "Output: $zipPath"
Write-Host "Size: $zipSizeKB KB"
Write-Host ""
Write-Host "Ready for Chrome Web Store upload." -ForegroundColor Yellow
