# Renders bold PWA icons (192 / 512 / maskable) — saturated bg + simple white glyph.
param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\icons")
)

Add-Type -AssemblyName System.Drawing

function New-BusClockIcon {
  param(
    [int]$Size,
    [double]$PadRatio = 0.12,
    [string]$BgHex = "#F97316"
  )

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $bg = [System.Drawing.ColorTranslator]::FromHtml($BgHex)
  $g.Clear($bg)

  $pad = [int]($Size * $PadRatio)
  $inner = $Size - 2 * $pad
  $white = [System.Drawing.Color]::White
  $whiteBrush = New-Object System.Drawing.SolidBrush $white
  $whitePen = New-Object System.Drawing.Pen($white, ([Math]::Max(2, [int]($Size / 96))))

  # 시계 원 (상단)
  $clockD = [int]($inner * 0.52)
  $cx = $pad + [int]($inner * 0.5)
  $cy = $pad + [int]($inner * 0.33)
  $half = [int]($clockD / 2)
  $g.FillEllipse($whiteBrush, $cx - $half, $cy - $half, $clockD, $clockD)
  $ringPen = New-Object System.Drawing.Pen($bg, ([Math]::Max(3, [int]($Size / 64))))
  $g.DrawEllipse($ringPen, $cx - $half + 2, $cy - $half + 2, $clockD - 4, $clockD - 4)

  $handPen = New-Object System.Drawing.Pen($bg, ([Math]::Max(4, [int]($Size / 42))))
  $handPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $handPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $hl = $clockD * 0.22
  $ml = $clockD * 0.32
  $g.DrawLine($handPen, $cx, $cy, $cx + $hl * 0.5, $cy - $hl)
  $g.DrawLine($handPen, $cx, $cy, $cx + $ml * 0.85, $cy + $ml * 0.35)

  # 버스 실루엣 (하단, 흰색 둥근 사각형)
  $busW = [int]($inner * 0.82)
  $busH = [int]($inner * 0.38)
  $bx = $pad + [int](($inner - $busW) / 2)
  $by = $pad + [int]($inner * 0.48)
  $radius = [Math]::Max(8, [int]($Size / 28))

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = New-Object System.Drawing.Rectangle $bx, $by, $busW, $busH
  $path.AddArc($r.X, $r.Y, $radius * 2, $radius * 2, 180, 90)
  $path.AddArc($r.Right - $radius * 2, $r.Y, $radius * 2, $radius * 2, 270, 90)
  $path.AddArc($r.Right - $radius * 2, $r.Bottom - $radius * 2, $radius * 2, $radius * 2, 0, 90)
  $path.AddArc($r.X, $r.Bottom - $radius * 2, $radius * 2, $radius * 2, 90, 90)
  $path.CloseFigure()
  $g.FillPath($whiteBrush, $path)

  # 창문 (배경색으로 파내기)
  $winW = [int]($busW * 0.28)
  $winH = [int]($busH * 0.36)
  $winY = $by + [int]($busH * 0.2)
  $gap = [int]($busW * 0.1)
  $wx1 = $bx + [int]($busW * 0.14)
  $wx2 = $wx1 + $winW + $gap
  $winBrush = New-Object System.Drawing.SolidBrush $bg
  $winR = [Math]::Max(4, [int]($Size / 64))
  foreach ($wx in @($wx1, $wx2)) {
    $wp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $wr = New-Object System.Drawing.Rectangle $wx, $winY, $winW, $winH
    $wp.AddArc($wr.X, $wr.Y, $winR * 2, $winR * 2, 180, 90)
    $wp.AddArc($wr.Right - $winR * 2, $wr.Y, $winR * 2, $winR * 2, 270, 90)
    $wp.AddArc($wr.Right - $winR * 2, $wr.Bottom - $winR * 2, $winR * 2, $winR * 2, 0, 90)
    $wp.AddArc($wr.X, $wr.Bottom - $winR * 2, $winR * 2, $winR * 2, 90, 90)
    $wp.CloseFigure()
    $g.FillPath($winBrush, $wp)
  }

  # 바퀴
  $wheelR = [Math]::Max(5, [int]($Size / 40))
  $wheelBrush = New-Object System.Drawing.SolidBrush $bg
  $g.FillEllipse($wheelBrush, $bx + [int]($busW * 0.2) - $wheelR, $by + $busH - [int]($wheelR * 0.6), $wheelR * 2, $wheelR * 2)
  $g.FillEllipse($wheelBrush, $bx + [int]($busW * 0.72) - $wheelR, $by + $busH - [int]($wheelR * 0.6), $wheelR * 2, $wheelR * 2)

  $g.Dispose()
  return $bmp
}

function Save-Icon([System.Drawing.Bitmap]$bmp, [string]$path) {
  $dir = Split-Path $path -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

$out = (Resolve-Path $OutDir).Path
$bmp512 = New-BusClockIcon -Size 512 -PadRatio 0.08
Save-Icon $bmp512 (Join-Path $out "icon-512.png")

$bmp192 = New-BusClockIcon -Size 192 -PadRatio 0.08
Save-Icon $bmp192 (Join-Path $out "icon-192.png")

$bmpMask = New-BusClockIcon -Size 512 -PadRatio 0.18
Save-Icon $bmpMask (Join-Path $out "icon-maskable-512.png")

$bmp512.Dispose()
$bmp192.Dispose()
$bmpMask.Dispose()

Write-Output "Icons written to $out"