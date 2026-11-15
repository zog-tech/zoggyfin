# Downloads a libmpv development build for Windows (x86_64) into desktop/libmpv-windows/.
#
# The build comes from https://github.com/shinchiro/mpv-winbuild-cmake (the "mpv-dev" archive:
# libmpv-2.dll and the headers). It is a GPL build: use it for development only, the same as
# Homebrew libmpv on macOS (see desktop/README.md, "The LGPL libmpv build").
#
#   powershell -ExecutionPolicy Bypass -File desktop/scripts/windows/setup-libmpv.ps1 [-Tag 20261111]
#
# Needs tar.exe with 7z support (in Windows 11). Without -Tag it takes the latest release.

param(
    [string]$Tag = ""
)

$ErrorActionPreference = "Stop"
$repo = "shinchiro/mpv-winbuild-cmake"
$dest = Join-Path $PSScriptRoot "..\..\libmpv-windows" | Resolve-Path -ErrorAction SilentlyContinue
if (-not $dest) {
    $dest = New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot "..\..\libmpv-windows")
}
$dest = "$dest"

$api = if ($Tag) { "https://api.github.com/repos/$repo/releases/tags/$Tag" } else { "https://api.github.com/repos/$repo/releases/latest" }
$release = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "zoggyfin-setup" }
$asset = $release.assets | Where-Object { $_.name -match '^mpv-dev-x86_64-\d' } | Select-Object -First 1
if (-not $asset) { throw "No mpv-dev-x86_64 archive in release $($release.tag_name)." }

$archive = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB) from $($release.tag_name)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archive
if ((Get-Item $archive).Length -ne $asset.size) { throw "The download has the wrong size." }

Get-ChildItem $dest -Force | Remove-Item -Recurse -Force
tar -xf $archive -C $dest
Remove-Item $archive
if (-not (Test-Path (Join-Path $dest "libmpv-2.dll"))) { throw "libmpv-2.dll is not in the archive." }
Set-Content -Path (Join-Path $dest "VERSION.txt") -Value "$repo $($release.tag_name) $($asset.name)"
Write-Host "libmpv is in $dest"
