# GhostBreak — create GitHub repo and push (run after: gh auth login)
$ErrorActionPreference = 'Stop'
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$root = Split-Path -Parent $PSScriptRoot

Set-Location $root

& $gh auth status
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Run first: gh auth login -h github.com -p https -w'
  exit 1
}

$login = & $gh api user --jq .login
Write-Host "Logged in as: $login"

$repo = 'ghostbreak'
$exists = & $gh repo view "$login/$repo" 2>$null
if ($LASTEXITCODE -ne 0) {
  & $gh repo create $repo --public --description 'GhostBreak anonymous breakup email and SMS delivery'
  Write-Host "Created https://github.com/$login/$repo"
} else {
  Write-Host "Repo already exists: https://github.com/$login/$repo"
}

git remote remove origin 2>$null
git remote add origin "https://github.com/$login/$repo.git"
git push -u origin main

Write-Host ''
Write-Host 'Done! Refresh Render and connect this repository.'
