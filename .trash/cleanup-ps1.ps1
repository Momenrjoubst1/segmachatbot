$ErrorActionPreference = 'Stop'
$src = "C:\Users\User\OneDrive\Desktop\New folder (5)\.delete-old-searchbar.ps1"
$dstDir = "C:\Users\User\OneDrive\Desktop\New folder (5)\.trash"
$dst = Join-Path $dstDir "delete-old-searchbar.ps1"
if (-not (Test-Path -LiteralPath $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
}
Move-Item -LiteralPath $src -Destination $dst -Force
Write-Output "Moved cleanup script to $dst"
