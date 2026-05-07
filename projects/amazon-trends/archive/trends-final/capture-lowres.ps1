#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'

$workspace = 'C:/Users/doris/.openclaw/workspace'
$shotDir = Join-Path $workspace 'trends-final/screenshots'
New-Item -ItemType Directory -Force -Path $shotDir | Out-Null

Write-Host '📸 正在截取低分辨率版本...'

$urls = @{
  books = 'https://www.amazon.com/gp/new-releases/books/'
  music = 'https://www.amazon.com/gp/new-releases/music/'
  movies = 'https://www.amazon.com/gp/new-releases/movies-tv/'
  videogames = 'https://www.amazon.com/gp/new-releases/videogames/'
  software = 'https://www.amazon.com/gp/new-releases/software/'
  digitalmusic = 'https://www.amazon.com/gp/new-releases/digital-music/'
}

$chromeCandidates = @(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Chromium/Application/chrome.exe',
  'C:/Program Files/chromium/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
)
$browser = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) {
  throw '未找到可用浏览器（Chrome/Chromium/Edge），无法生成截图。'
}

foreach ($entry in $urls.GetEnumerator()) {
  $category = $entry.Key
  $url = $entry.Value
  $outFile = Join-Path $shotDir ($category + '.png')
  Write-Host "  🔄 $category ..."
  & $browser --headless --disable-gpu --window-size=1920,800 --screenshot=$outFile $url | Out-Null
}

Write-Host '✅ 所有截图完成！'
Get-ChildItem $shotDir | Select-Object Name,Length | Format-Table -AutoSize
