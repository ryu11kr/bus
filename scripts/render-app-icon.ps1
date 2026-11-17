# PWA icons — large front bus + small clock on roof (top-right overlap).
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

function Draw-SmallClock {
  param(
    [System.Drawing.Graphics]$G,
    [int]$Cx,
    [int]$Cy,
    [int]$D,
    [System.Drawing.Color]$Bg,
    [System.Drawing.Color]$Face
  )
  $half = [int]($D / 2)
  $faceBrush = New-Object System.Drawing.SolidBrush $Face
  $bgBrush = New-Object System.Drawing.SolidBrush $Bg

  # 바깥 테두리(버스 흰색 위에서도 눈에 띔)
  $outer = [Math]::Max(3, [int]($D / 14))
  $outerPen = New-Object System.Drawing.Pen($Bg, $outer)
  $G.DrawEllipse($outerPen, $Cx - $half - [int]($outer / 2), $Cy - $half - [int]($outer / 2), $D + $outer, $D + $outer)

  $G.FillEllipse($faceBrush, $Cx - $half, $Cy - $half, $D, $D)

  $ringW = [Math]::Max(2, [int]($D / 16))
  $ringPen = New-Object System.Drawing.Pen($Bg, $ringW)
  $G.DrawEllipse($ringPen, $Cx - $half + $ringW, $Cy - $half + $ringW, $D - $ringW * 2, $D - $ringW * 2)

  $tickPen = New-Object System.Drawing.Pen($Bg, ([Math]::Max(1, [int]($D / 40))))
  $tickPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $tickPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $tickR = $half - [Math]::Max(2, [int]($D / 10))
  for ($i = 0; $i -lt 12; $i++) {
    $ang = ($i * 30 - 90) * [Math]::PI / 180
    $len = if ($i % 3 -eq 0) { 3 } else { 2 }
    $x1 = $Cx + [int]([Math]::Cos($ang) * ($tickR - $len))
    $y1 = $Cy + [int]([Math]::Sin($ang) * ($tickR - $len))
    $x2 = $Cx + [int]([Math]::Cos($ang) * $tickR)
    $y2 = $Cy + [int]([Math]::Sin($ang) * $tickR)
    $G.DrawLine($tickPen, $x1, $y1, $x2, $y2)
  }

  $handPen = New-Object System.Drawing.Pen($Bg, ([Math]::Max(2, [int]($D / 11))))
  $handPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $handPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $G.DrawLine($handPen, $Cx, $Cy, $Cx + [int]($D * 0.12), $Cy - [int]($D * 0.22))
  $G.DrawLine($handPen, $Cx, $Cy, $Cx + [int]($D * 0.26), $Cy + [int]($D * 0.1))
  $dot = [Math]::Max(2, [int]($D / 12))
  $G.FillEllipse($bgBrush, $Cx - $dot, $Cy - $dot, $dot * 2, $dot * 2)
}

function New-BusClockIcon {
  param(
    [int]$Size,
    [double]$PadRatio = 0.08,
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

  # —— 버스 정면 (세로로 길게, 폭은 좁게) ——
  $busW = [int]($inner * 0.76)
  $busH = [int]($inner * 0.78)
  $bx = $pad + [int](($inner - $busW) / 2)
  $by = $pad + [int]($inner * 0.2)
  $busRad = [Math]::Max(12, [int]($Size / 18))

  $bodyPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $bodyR = New-Object System.Drawing.Rectangle $bx, $by, $busW, $busH
  Add-RoundedRectPath -Path $bodyPath -R $bodyR -Radius $busRad
  $g.FillPath($whiteBrush, $bodyPath)

  # 앞 유리
  $glassW = [int]($busW * 0.8)
  $glassH = [int]($busH * 0.34)
  $gx = $bx + [int](($busW - $glassW) / 2)
  $gy = $by + [int]($busH * 0.24)
  $glassRad = [Math]::Max(8, [int]($Size / 40))
  $glassPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $glassR = New-Object System.Drawing.Rectangle $gx, $gy, $glassW, $glassH
  Add-RoundedRectPath -Path $glassPath -R $glassR -Radius $glassRad
  $g.FillPath($bgBrush, $glassPath)

  # 그릴
  $grillPen = New-Object System.Drawing.Pen($bg, ([Math]::Max(3, [int]($Size / 64))))
  $grillPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $grillPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $grillY1 = $by + [int]($busH * 0.6)
  $grillY2 = $by + [int]($busH * 0.82)
  $grillCx = $bx + [int]($busW / 2)
  $grillSpan = [int]($busW * 0.09)
  foreach ($dx in @(-$grillSpan, 0, $grillSpan)) {
    $g.DrawLine($grillPen, $grillCx + $dx, $grillY1, $grillCx + $dx, $grillY2)
  }

  # 헤드라이트
  $lightR = [Math]::Max(8, [int]($Size / 28))
  $ly = $by + [int]($busH * 0.56)
  $lxL = $bx + [int]($busW * 0.1)
  $lxR = $bx + $busW - [int]($busW * 0.1) - $lightR * 2
  $g.FillEllipse($whiteBrush, $lxL, $ly, $lightR * 2, $lightR * 2)
  $g.FillEllipse($whiteBrush, $lxR, $ly, $lightR * 2, $lightR * 2)
  $g.FillEllipse($bgBrush, $lxL + [int]($lightR * 0.3), $ly + [int]($lightR * 0.3), [int]($lightR * 1.4), [int]($lightR * 1.4))
  $g.FillEllipse($bgBrush, $lxR + [int]($lightR * 0.3), $ly + [int]($lightR * 0.3), [int]($lightR * 1.4), [int]($lightR * 1.4))

  # 범퍼
  $bumperH = [Math]::Max(5, [int]($Size / 44))
  $bumperPen = New-Object System.Drawing.Pen($bg, $bumperH)
  $bumperPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $bumperPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $bumY = $by + $busH - [int]($busH * 0.1)
  $g.DrawLine($bumperPen, $bx + [int]($busW * 0.08), $bumY, $bx + $busW - [int]($busW * 0.08), $bumY)

  # —— 작은 시계: 천장 우측에 겹침 (버스 뒤에 그리지 않고 위에) ——
  $clockD = [int]($inner * 0.36)
  $clockCx = $bx + $busW - [int]($clockD * 0.4)
  $clockCy = $by + [int]($clockD * 0.34)
  Draw-SmallClock -G $g -Cx $clockCx -Cy $clockCy -D $clockD -Bg $bg -Face $white

  $g.Dispose()
  return $bmp
}

function Save-Icon([System.Drawing.Bitmap]$bmp, [string]$path) {
  $dir = Split-Path $path -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

$out = (Resolve-Path $OutDir).Path
$bmp512 = New-BusClockIcon -Size 512 -PadRatio 0.07
Save-Icon $bmp512 (Join-Path $out "icon-512.png")

$bmp192 = New-BusClockIcon -Size 192 -PadRatio 0.07
Save-Icon $bmp192 (Join-Path $out "icon-192.png")

$bmpMask = New-BusClockIcon -Size 512 -PadRatio 0.17
Save-Icon $bmpMask (Join-Path $out "icon-maskable-512.png")

$bmp512.Dispose()
$bmp192.Dispose()
$bmpMask.Dispose()

Write-Output "Icons written to $out"