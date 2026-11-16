# Renders bus + clock PWA icons (192 / 512 / maskable).
param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\icons")
)

Add-Type -AssemblyName System.Drawing

function New-BusClockIcon {
  param([int]$Size, [double]$PadRatio = 0.1)

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(255, 233, 237, 240))

  $pad = [int]($Size * $PadRatio)
  $inner = $Size - 2 * $pad

  # 시계·버스를 아이콘 안에 최대한 꽉 차게 (여백은 PadRatio로만)
  $blue = [System.Drawing.Color]::FromArgb(255, 2, 132, 199)
  $dark = [System.Drawing.Color]::FromArgb(255, 3, 105, 161)
  $orange = [System.Drawing.Color]::FromArgb(255, 234, 88, 12)
  $white = [System.Drawing.Color]::White
  $ink = [System.Drawing.Color]::FromArgb(255, 12, 74, 110)

  $clockSize = [int]($inner * 0.72)
  $cx = $pad + [int]($inner * 0.41)
  $cy = $pad + [int]($inner * 0.34)

  $clockBrush = New-Object System.Drawing.SolidBrush $white
  $half = [int]($clockSize / 2)
  $g.FillEllipse($clockBrush, $cx - $half, $cy - $half, $clockSize, $clockSize)
  $clockPen = New-Object System.Drawing.Pen($dark, ([Math]::Max(2, [int]($Size / 64))))
  $g.DrawEllipse($clockPen, $cx - $half, $cy - $half, $clockSize, $clockSize)

  $hourLen = $clockSize * 0.24
  $minLen = $clockSize * 0.34
  $hourAng = -50 * [Math]::PI / 180
  $minAng = 75 * [Math]::PI / 180
  $hourPen = New-Object System.Drawing.Pen($ink, ([Math]::Max(3, [int]($Size / 48))))
  $minPen = New-Object System.Drawing.Pen($orange, ([Math]::Max(2, [int]($Size / 56))))
  $hourPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $hourPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $minPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $minPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine(
    $hourPen,
    $cx, $cy,
    $cx + $hourLen * [Math]::Cos($hourAng),
    $cy + $hourLen * [Math]::Sin($hourAng)
  )
  $g.DrawLine(
    $minPen,
    $cx, $cy,
    $cx + $minLen * [Math]::Cos($minAng),
    $cy + $minLen * [Math]::Sin($minAng)
  )
  $dotBrush = New-Object System.Drawing.SolidBrush $orange
  $dot = [Math]::Max(4, [int]($Size / 64))
  $g.FillEllipse($dotBrush, $cx - $dot / 2, $cy - $dot / 2, $dot, $dot)

  $busW = [int]($inner * 0.80)
  $busH = [int]($inner * 0.48)
  $bx = $pad + [int]($inner * 0.16)
  $by = $pad + [int]($inner * 0.44)
  $busRect = New-Object System.Drawing.Rectangle $bx, $by, $busW, $busH
  $busBrush = New-Object System.Drawing.SolidBrush $blue
  $g.FillRectangle($busBrush, $busRect)
  $radius = [Math]::Min(16, [int]($Size / 20))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($busRect.X, $busRect.Y, $radius * 2, $radius * 2, 180, 90)
  $path.AddArc($busRect.Right - $radius * 2, $busRect.Y, $radius * 2, $radius * 2, 270, 90)
  $path.AddArc($busRect.Right - $radius * 2, $busRect.Bottom - $radius * 2, $radius * 2, $radius * 2, 0, 90)
  $path.AddArc($busRect.X, $busRect.Bottom - $radius * 2, $radius * 2, $radius * 2, 90, 90)
  $path.CloseFigure()
  $g.FillPath($busBrush, $path)

  $winH = [int]($busH * 0.38)
  $winY = $by + [int]($busH * 0.18)
  $winW = [int]($busW * 0.32)
  $gap = [int]($busW * 0.08)
  $winBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 255, 255, 255))
  $wx1 = $bx + [int]($busW * 0.12)
  $wx2 = $wx1 + $winW + $gap
  $g.FillRectangle($winBrush, $wx1, $winY, $winW, $winH)
  $g.FillRectangle($winBrush, $wx2, $winY, $winW, $winH)

  $wheelR = [Math]::Max(4, [int]($Size / 48))
  $wheelBrush = New-Object System.Drawing.SolidBrush $ink
  $g.FillEllipse($wheelBrush, $bx + [int]($busW * 0.22) - $wheelR, $by + $busH - $wheelR / 2, $wheelR * 2, $wheelR * 2)
  $g.FillEllipse($wheelBrush, $bx + [int]($busW * 0.72) - $wheelR, $by + $busH - $wheelR / 2, $wheelR * 2, $wheelR * 2)

  $g.Dispose()
  return $bmp
}

function Save-Icon([System.Drawing.Bitmap]$bmp, [string]$path) {
  $dir = Split-Path $path -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

$out = (Resolve-Path $OutDir).Path
$bmp512 = New-BusClockIcon -Size 512 -PadRatio 0.04
Save-Icon $bmp512 (Join-Path $out "icon-512.png")

$bmp192 = New-BusClockIcon -Size 192 -PadRatio 0.04
Save-Icon $bmp192 (Join-Path $out "icon-192.png")

$bmpMask = New-BusClockIcon -Size 512 -PadRatio 0.09
Save-Icon $bmpMask (Join-Path $out "icon-maskable-512.png")

$bmp512.Dispose()
$bmp192.Dispose()
$bmpMask.Dispose()

Write-Output "Icons written to $out"