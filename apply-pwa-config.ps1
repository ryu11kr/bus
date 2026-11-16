# pwa.config.json → manifest, sw.config.js, index/offline 메타 반영
param([string] $Root = $PSScriptRoot)

$configPath = Join-Path $Root "pwa.config.json"
if (-not (Test-Path $configPath -PathType Leaf)) {
  Write-Error "pwa.config.json 을 찾을 수 없습니다."
  exit 1
}

$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$utf8 = New-Object Text.UTF8Encoding $false

$manifest = [ordered]@{
  id = "./"
  name = $config.name
  short_name = $config.shortName
  description = $config.description
  lang = $config.lang
  dir = "ltr"
  start_url = "./?source=pwa"
  scope = "./"
  display = "standalone"
  orientation = $config.orientation
  background_color = $config.backgroundColor
  theme_color = $config.themeColor
  categories = @($config.categories)
  icons = @(
    @{
      src = "icons/icon-192.png"
      sizes = "192x192"
      type = "image/png"
      purpose = "any"
    },
    @{
      src = "icons/icon-512.png"
      sizes = "512x512"
      type = "image/png"
      purpose = "any"
    },
    @{
      src = "icons/icon-maskable-512.png"
      sizes = "512x512"
      type = "image/png"
      purpose = "maskable"
    }
  )
}

$manifestJson = ($manifest | ConvertTo-Json -Depth 6)
[IO.File]::WriteAllText((Join-Path $Root "manifest.webmanifest"), $manifestJson, $utf8)

$swConfig = @"
/* pwa.config.json 의 cachePrefix 와 맞춥니다. apply-config.cmd 로 자동 동기화 */
var CACHE_PREFIX = "$($config.cachePrefix)";
"@
[IO.File]::WriteAllText((Join-Path $Root "sw.config.js"), $swConfig, $utf8)

function Set-HtmlMeta {
  param([string] $Path, [string] $TitleSuffix)
  if (-not (Test-Path $Path -PathType Leaf)) { return }
  $html = [IO.File]::ReadAllText($Path, $utf8)
  $title = if ($TitleSuffix) { "$($config.shortName) · $TitleSuffix" } else { $config.shortName }
  $html = $html -replace '(?<=<meta name="theme-color" content=")[^"]*', $config.themeColor
  $html = $html -replace '(?<=<meta name="description" content=")[^"]*', $config.description
  $html = $html -replace '(?<=<meta name="apple-mobile-web-app-title" content=")[^"]*', $config.shortName
  $html = $html -replace '(?<=<title>)[^<]*(?=</title>)', $title
  [IO.File]::WriteAllText($Path, $html, $utf8)
}

Set-HtmlMeta -Path (Join-Path $Root "index.html") -TitleSuffix ""
Set-HtmlMeta -Path (Join-Path $Root "offline.html") -TitleSuffix "오프라인"

Write-Output "적용됨: $($config.name) (cachePrefix=$($config.cachePrefix))"