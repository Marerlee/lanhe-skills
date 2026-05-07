#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'

$workspace = 'C:/Users/doris/.openclaw/workspace'
$workDir = Join-Path $workspace 'trends-optimized'
$screenDir = Join-Path $workDir 'screenshots'
$sourceDir = Join-Path $workspace 'trends-ultra/screenshots'
New-Item -ItemType Directory -Force -Path $screenDir | Out-Null

Get-ChildItem $sourceDir -Filter *.png -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item $_.FullName -Destination (Join-Path $screenDir $_.Name) -Force
}

Write-Host '🔄 开始压缩图片...'

$magick = @(
  'C:/Program Files/ImageMagick-7.1.1-Q16-HDRI/magick.exe',
  'C:/Program Files/ImageMagick-7.1.1-Q16/magick.exe',
  'magick'
)
$magickCmd = $magick | Select-Object -First 1

$usedMagick = $false
foreach ($img in Get-ChildItem $screenDir -Filter *.png -ErrorAction SilentlyContinue) {
  $outFile = Join-Path $screenDir ($img.BaseName + '-compressed.png')
  try {
    & $magickCmd $img.FullName -quality 70 -resize 50% $outFile | Out-Null
    if (Test-Path $outFile) { $usedMagick = $true }
  } catch {}
}

if (-not $usedMagick) {
  Write-Host '⚠️ ImageMagick 不可用，改用浏览器重新截取低质量版本...'
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
    throw '未找到可用浏览器（Chrome/Chromium/Edge），无法重新截图。'
  }
  foreach ($entry in $urls.GetEnumerator()) {
    $category = $entry.Key
    $url = $entry.Value
    $outFile = Join-Path $screenDir ($category + '-lowres.png')
    Write-Host "  📸 正在截取 $category ..."
    & $browser --headless --disable-gpu --window-size=1920,1200 --screenshot=$outFile $url | Out-Null
  }
}

Write-Host '✅ 图片处理完成！'
(Get-ChildItem $screenDir -Filter '*compressed.png' -ErrorAction SilentlyContinue | Measure-Object).Count
