# Renders bold PWA icons (192 / 512 / maskable) — orange bg, large clock + front bus.
param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\icons")
)

Add-Type -AssemblyName System.Drawing

function Add-RoundedRectPath {
  param(
    [System.Drawing.Drawing2D.GraphicsPath]$Path,
    [System.Drawing.Rectangle]$R,
    [int]$Radius
  )
  $rad = [Math]::Min($Radius, [Math]::Min($R.Width, $R.Height) / 2)
  $Path.AddArc($R.X, $R.Y, $rad * 2, $rad * 2, 180, 90)
  $Path.AddArc($R.Right - $rad * 2, $R.Y, $rad * 2, $rad * 2, 270, 90)
  $Path.AddArc($R.Right - $rad * 2, $R.Bottom - $rad * 2, $rad * 2, $rad * 2, 0, 90)
  $Path.AddArc($R.X, $R.Bottom - $rad * 2, $rad * 2, $rad * 2, 90, 90)
  $Path.CloseFigure()
}

function New-BusClockIcon {
  param(
    [int]$Size,
    [double]$PadRatio = 0.1,
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
  $bgBrush = New-Object System.Drawing.SolidBrush $bg

  # —— 시계 (크게, 상단 중앙) ——
  $clockD = [int]($inner * 0.62)
  $cx = $pad + [int]($inner * 0.5)
  $cy = $pad + [int]($inner * 0.36)
  $half = [int]($clockD / 2)
  $g.FillEllipse($whiteBrush, $cx - $half, $cy - $half, $clockD, $clockD)

  $ringW = [Math]::Max(4, [int]($Size / 56))
  $ringPen = New-Object System.Drawing.Pen($bg, $ringW)
  $g.DrawEllipse($ringPen, $cx - $half + $ringW, $cy - $half + $ringW, $clockD - $ringW * 2, $clockD - $ringW * 2)

  $tickPen = New-Object System.Drawing.Pen($bg, ([Math]::Max(2, [int]($Size / 128))))
  $tickPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $tickPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $tickR = $half - [int]($Size / 40)
  for ($i = 0; $i -lt 12; $i++) {
    $ang = ($i * 30 - 90) * [Math]::PI / 180
    $x1 = $cx + [int]([Math]::Cos($ang) * ($tickR - [int]($Size / 80)))
    $y1 = $cy + [int]([Math]::Sin($ang) * ($tickR - [int]($Size / 80)))
    $x2 = $cx + [int]([Math]::Cos($ang) * $tickR)
    $y2 = $cy + [int]([Math]::Sin($ang) * $tickR)
    $g.DrawLine($tickPen, $x1, $y1, $x2, $y2)
  }

  $handPen = New-Object System.Drawing.Pen($bg, ([Math]::Max(5, [int]($Size / 36))))
  $handPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $handPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $hl = $clockD * 0.26
  $ml = $clockD * 0.36
  $g.DrawLine($handPen, $cx, $cy, $cx + $hl * 0.55, $cy - $hl)
  $g.DrawLine($handPen, $cx, $cy, $cx + $ml * 0.9, $cy + $ml * 0.38)
  $g.FillEllipse($bgBrush, $cx - [int]($Size / 42), $cy - [int]($Size / 42), [int]($Size / 21), [int]($Size / 21))

  # —— 버스 정면 (하단, 큼직하게) ——
  $busW = [int]($inner * 0.8)
  $busH = [int]($inner * 0.4)
  $bx = $pad + [int](($inner - $busW) / 2)
  $by = $pad + [int]($inner * 0.52)
  $busRad = [Math]::Max(10, [int]($Size / 22))

  $bodyPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $bodyR = New-Object System.Drawing.Rectangle $bx, $by, $busW, $busH
  Add-RoundedRectPath -Path $bodyPath -R $bodyR -Radius $busRad
  $g.FillPath($whiteBrush, $bodyPath)

  # 앞 유리 (넓은 정면 유리)
  $glassW = [int]($busW * 0.78)
  $glassH = [int]($busH * 0.4)
  $gx = $bx + [int](($busW - $glassW) / 2)
  $gy = $by + [int]($busH * 0.1)
  $glassRad = [Math]::Max(6, [int]($Size / 48))
  $glassPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $glassR = New-Object System.Drawing.Rectangle $gx, $gy, $glassW, $glassH
  Add-RoundedRectPath -Path $glassPath -R $glassR -Radius $glassRad
  $g.FillPath($bgBrush, $glassPath)

  # 그릴 세로줄 (정면 느낌)
  $grillPen = New-Object System.Drawing.Pen($bg, ([Math]::Max(3, [int]($Size / 72))))
  $grillPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $grillPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $grillY1 = $by + [int]($busH * 0.58)
  $grillY2 = $by + [int]($busH * 0.78)
  $grillCx = $bx + [int]($busW / 2)
  $grillSpan = [int]($busW * 0.08)
  foreach ($dx in @(-$grillSpan, 0, $grillSpan)) {
    $g.DrawLine($grillPen, $grillCx + $dx, $grillY1, $grillCx + $dx, $grillY2)
  }

  # 헤드라이트 (좌·우 큰 원)
  $lightR = [Math]::Max(7, [int]($Size / 30))
  $ly = $by + [int]($busH * 0.55)
  $lxL = $bx + [int]($busW * 0.12)
  $lxR = $bx + $busW - [int]($busW * 0.12) - $lightR * 2
  $g.FillEllipse($whiteBrush, $lxL, $ly, $lightR * 2, $lightR * 2)
  $g.FillEllipse($whiteBrush, $lxR, $ly, $lightR * 2, $lightR * 2)
  $g.FillEllipse($bgBrush, $lxL + [int]($lightR * 0.32), $ly + [int]($lightR * 0.32), [int]($lightR * 1.35), [int]($lightR * 1.35))
  $g.FillEllipse($bgBrush, $lxR + [int]($lightR * 0.32), $ly + [int]($lightR * 0.32), [int]($lightR * 1.35), [int]($lightR * 1.35))

  # 범퍼
  $bumperH = [Math]::Max(4, [int]($Size / 48))
  $bumperPen = New-Object System.Drawing.Pen($bg, $bumperH)
  $bumperPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $bumperPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $bumY = $by + $busH - [int]($busH * 0.12)
  $g.DrawLine($bumperPen, $bx + [int]($busW * 0.1), $bumY, $bx + $busW - [int]($busW * 0.1), $bumY)

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