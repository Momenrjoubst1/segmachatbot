$ErrorActionPreference = 'Stop'
$src = "C:\Users\User\OneDrive\Desktop\New folder (5)\.finalcleanup.ps1"
$dstDir = "C:\Users\User\OneDrive\Desktop\New folder (5)\.trash"
$dst = Join-Path $dstDir "finalcleanup.ps1"
if (-not (Test-Path -LiteralPath $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
}
Move-Item -LiteralPath $src -Destination $dst -Force
Write-Output "Trashed: $dst"
