$ErrorActionPreference = 'Stop'
$src = "C:\Users\User\OneDrive\Desktop\New folder (5)\frontend\src\components\ui\animated-search-bar.tsx"
$dstDir = "C:\Users\User\OneDrive\Desktop\New folder (5)\.trash"
$dst = Join-Path $dstDir "animated-search-bar.tsx"
if (-not (Test-Path -LiteralPath $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
}
Move-Item -LiteralPath $src -Destination $dst -Force
Write-Output "Moved to $dst"
