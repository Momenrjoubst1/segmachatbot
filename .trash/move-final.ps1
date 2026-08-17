$ErrorActionPreference = 'Stop'
$src = "C:\Users\User\OneDrive\Desktop\New folder (5)\.trashme3.ps1"
$dstDir = "C:\Users\User\OneDrive\Desktop\New folder (5)\.trash"
$dst = Join-Path $dstDir "trashme3.ps1"
if (-not (Test-Path -LiteralPath $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
}
Move-Item -LiteralPath $src -Destination $dst -Force
Write-Output "Trashed: $dst"
Move-Item -LiteralPath "C:\Users\User\OneDrive\Desktop\New folder (5)\.move-final.ps1" -Destination (Join-Path $dstDir "move-final.ps1") -Force
