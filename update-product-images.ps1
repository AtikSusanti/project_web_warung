<#
.SYNOPSIS
    Download product images from Wikimedia Commons for Warung catalog.
#>

$ErrorActionPreference = 'Stop'

$products = @(
    @{ sku="ALK-001"; title="Obat Nyamuk Cair"; search="insect repellent spray bottle indonesia" },
    @{ sku="MIN-001"; title="Air Mineral 600ml"; search="bottled water plastic bottle indonesia" },
    @{ sku="MIN-002"; title="Teh Botol Sosro 450ml"; search="bottled tea drink indonesia" },
    @{ sku="MIN-003"; title="Kopi Kapal Api Sachet"; search="instant coffee sachet indonesia" },
    @{ sku="RT-001"; title="Sabun Mandi Cair 450ml"; search="liquid soap bottle indonesia" },
    @{ sku="RT-002"; title="Deterjen Bubuk 800g"; search="laundry detergent powder box" },
    @{ sku="RT-003"; title="Tisu Basah Saku"; search="wet wipes package" },
    @{ sku="SBK-001"; title="Beras Pandan Wangi 5kg"; search="jasmine rice bag 5kg" },
    @{ sku="SBK-002"; title="Minyak Goreng 1L"; search="cooking oil 1 liter bottle" },
    @{ sku="SBK-003"; title="Gula Pasir 1kg"; search="white sugar 1kg packaging" },
    @{ sku="SBK-004"; title="Tepung Terigu 1kg"; search="wheat flour 1kg bag" },
    @{ sku="SBK-005"; title="Garam Halus 250g"; search="fine salt 250g packaging" },
    @{ sku="SNK-001"; title="Indomie Goreng"; search="indomie goreng instant noodle" },
    @{ sku="SNK-002"; title="Chitato 68g"; search="potato chips packaging" },
    @{ sku="SNK-003"; title="Oreo Sandwich"; search="oreo sandwich cookies packaging" }
)

$ErrorActionPreference = 'Stop'

$destDir = "apps/web/public/images/products"
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
$successCount = 0
$failed = @()
$warnings = @()

Write-Host "=== Download Gambar Produk dari Wikimedia Commons ==="
Write-Host ("Target: " + $destDir)
Write-Host ""

if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Force -Path $tempDir | Out-Null }

$successCount = 0
$failed = @()
$warnings = @()

$products = @(
    @{ sku="ALK-001"; title="Obat Nyamuk Cair"; search="insect repellent spray bottle indonesia" },
    @{ sku="MIN-001"; title="Air Mineral 600ml"; search="bottled water plastic bottle indonesia" },
    @{ sku="MIN-002"; title="Teh Botol Sosro 450ml"; search="bottled tea drink indonesia" },
    @{ sku="MIN-003"; title="Kopi Kapal Api Sachet"; search="instant coffee sachet indonesia" },
    @{ sku="RT-001"; title="Sabun Mandi Cair 450ml"; search="liquid soap bottle indonesia" },
    @{ sku="RT-002"; title="Deterjen Bubuk 800g"; search="laundry detergent powder box" },
    @{ sku="RT-003"; title="Tisu Basah Saku"; search="wet wipes package" },
    @{ sku="SBK-001"; title="Beras Pandan Wangi 5kg"; search="jasmine rice bag 5kg" },
    @{ sku="SBK-002"; title="Minyak Goreng 1L"; search="cooking oil 1 liter bottle" },
    @{ sku="SBK-003"; title="Gula Pasir 1kg"; search="white sugar 1kg packaging" },
    @{ sku="SBK-004"; title="Tepung Terigu 1kg"; search="wheat flour 1kg bag" },
    @{ sku="SBK-005"; title="Garam Halus 250g"; search="fine salt 250g packaging" },
    @{ sku="SNK-001"; title="Indomie Goreng"; search="indomie goreng instant noodle" },
    @{ sku="SNK-002"; title="Chitato 68g"; search="potato chips packaging" },
    @{ sku="SNK-003"; title="Oreo Sandwich"; search="oreo sandwich cookies packaging" }
)

Write-Host "=== Download Gambar Produk dari Wikimedia Commons ==="
Write-Host ("Target: " + $destDir)
Write-Host ""

if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Force -Path $tempDir | Out-Null }

$successCount = 0
$failed = @()
$warnings = @()

function Get-WikiFile {
    param($query, $license)
    $apiUrl = "https://commons.wikimedia.org/w/api.php"
    $params = @{
        action = 'query'
        list = 'search'
        srsearch = $query
        srlimit = 5
        srnamespace = 6
        format = 'json'
        srprop = 'snippet|title'
    }
    try {
        $encoded = @()
        foreach ($kv in $params.GetEnumerator()) {
            $encoded += "$($kv.Key)=" + [System.Uri]::EscapeDataString($kv.Value)
        }
        $url = "https://commons.wikimedia.org/w/api.php?" + ($encoded -join '&')
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 15 -ErrorAction Stop
        $data = $response.Content | ConvertFrom-Json
        if (-not $data.query.search) { return $null }
        foreach ($item in $data.query.search) {
            $title = $item.title
            $snippet = $item.snippet -join ' '
            $licenseOk = $true
            if ($license -and $license -ne 'any') {
                $licenseOk = $false
                if ($snippet -match 'CC0|public domain') { $licenseOk = $true }
                if ($snippet -match 'CC BY') { $licenseOk = $true }
                if ($snippet -match 'CC BY-SA') { $licenseOk = $true }
            }
            if ($licenseOk -or -not $license -or $license -eq 'any') {
                return "File:$title"
            }
        }
        if ($data.query.search.Count -gt 0) { return "File:$($data.query.search[0].title)" }
    } catch { Write-Warning "Search failed: $($_.Exception.Message)" }
    return $null
}

function Get-ImgInfo {
    param($fileTitle)
    $apiUrl = "https://commons.wikimedia.org/w/api.php"
    $params = @{
        action = 'query'
        titles = $fileTitle
        prop = 'imageinfo'
        iiprop = 'url|size|mime|extmetadata'
        iiurlwidth = 400
        iiurlheight = 400
        format = 'json'
    }
    try {
        $url = "https://commons.wikimedia.org/w/api.php?" + (($params.GetEnumerator() | ForEach-Object { "$($_.Key)=$([System.Uri]::EscapeDataString($_.Value))" }) -join '&')
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 15 -ErrorAction Stop
        $data = $response.Content | ConvertFrom-Json
        $page = $data.query.pages.Values[0]
        if ($page.imageinfo) {
            $info = $page.imageinfo[0]
            return @{
                url = $info.url
                width = $info.width
                height = $info.height
                mime = $info.mime
                license = $info.extmetadata.LicenseShort.value
            }
        }
    } catch { Write-Warning "Get image info failed: $($_.Exception.Message)" }
    return $null
}

$destDir = "apps/web/public/images/products"
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
$successCount = 0
$failed = @()
$warnings = @()

Write-Host "=== Download Gambar Produk dari Wikimedia Commons ==="
Write-Host ("Target: " + $destDir)
Write-Host ""

if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Force -Path $tempDir | Out-Null }

$successCount = 0
$failed = @()
$warnings = @()

$products = @(
    @{ sku="ALK-001"; title="Obat Nyamuk Cair"; search="insect repellent spray bottle indonesia" },
    @{ sku="MIN-001"; title="Air Mineral 600ml"; search="bottled water plastic bottle indonesia" },
    @{ sku="MIN-002"; title="Teh Botol Sosro 450ml"; search="bottled tea drink indonesia" },
    @{ sku="MIN-003"; title="Kopi Kapal Api Sachet"; search="instant coffee sachet indonesia" },
    @{ sku="RT-001"; title="Sabun Mandi Cair 450ml"; search="liquid soap bottle indonesia" },
    @{ sku="RT-002"; title="Deterjen Bubuk 800g"; search="laundry detergent powder box" },
    @{ sku="RT-003"; title="Tisu Basah Saku"; search="wet wipes package" },
    @{ sku="SBK-001"; title="Beras Pandan Wangi 5kg"; search="jasmine rice bag 5kg" },
    @{ sku="SBK-002"; title="Minyak Goreng 1L"; search="cooking oil 1 liter bottle" },
    @{ sku="SBK-003"; title="Gula Pasir 1kg"; search="white sugar 1kg packaging" },
    @{ sku="SBK-004"; title="Tepung Terigu 1kg"; search="wheat flour 1kg bag" },
    @{ sku="SBK-005"; title="Garam Halus 250g"; search="fine salt 250g packaging" },
    @{ sku="SNK-001"; title="Indomie Goreng"; search="indomie goreng instant noodle" },
    @{ sku="SNK-002"; title="Chitato 68g"; search="potato chips packaging" },
    @{ sku="SNK-003"; title="Oreo Sandwich"; search="oreo sandwich cookies packaging" }
)

Write-Host "=== Download Gambar Produk dari Wikimedia Commons ==="
Write-Host ("Target: " + $destDir)
Write-Host ""

if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Force -Path $tempDir | Out-Null }

$successCount = 0
$failed = @()
$warnings = @()

function Get-WikiFile {
    param($query, $license)
    $apiUrl = "https://commons.wikimedia.org/w/api.php"
    $params = @{
        action = 'query'
        list = 'search'
        srsearch = $query
        srlimit = 5
        srnamespace = 6
        format = 'json'
        srprop = 'snippet|title'
    }
    try {
        $encoded = @()
        foreach ($kv in $params.GetEnumerator()) {
            $encoded += "$($kv.Key)=" + [System.Uri]::EscapeDataString($kv.Value)
        }
        $url = "https://commons.wikimedia.org/w/api.php?" + ($encoded -join '&')
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 15 -ErrorAction Stop
        $data = $response.Content | ConvertFrom-Json
        if (-not $data.query.search) { return $null }
        foreach ($item in $data.query.search) {
            $title = $item.title
            $snippet = $item.snippet -join ' '
            $licenseOk = $true
            if ($license -and $license -ne 'any') {
                $licenseOk = $false
                if ($snippet -match 'CC0|public domain') { $licenseOk = $true }
                if ($snippet -match 'CC BY') { $licenseOk = $true }
                if ($snippet -match 'CC BY-SA') { $licenseOk = $true }
            }
            if ($licenseOk -or -not $license -or $license -eq 'any') {
                return "File:$title"
            }
        }
        if ($data.query.search.Count -gt 0) { return "File:$($data.query.search[0].title)" }
    } catch { Write-Warning "Search failed: $($_.Exception.Message)" }
    return $null
}

function Get-ImgInfo {
    param($fileTitle)
    $apiUrl = "https://commons.wikimedia.org/w/api.php"
    $params = @{
        action = 'query'
        titles = $fileTitle
        prop = 'imageinfo'
        iiprop = 'url|size|mime|extmetadata'
        iiurlwidth = 400
        iiurlheight = 400
        format = 'json'
    }
    try {
        $url = "https://commons.wikimedia.org/w/api.php?" + (($params.GetEnumerator() | ForEach-Object { "$($_.Key)=$([System.Uri]::EscapeDataString($_.Value))" }) -join '&')
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 15 -ErrorAction Stop
        $data = $response.Content | ConvertFrom-Json
        $page = $data.query.pages.Values[0]
        if ($page.imageinfo) {
            $info = $page.imageinfo[0]
            return @{
                url = $info.url
                width = $info.width
                height = $info.height
                mime = $info.mime
                license = $info.extmetadata.LicenseShort.value
            }
        }
    } catch { Write-Warning "Get image info failed: $($_.Exception.Message)" }
    return $null
}

$destDir = "apps/web/public/images/products"
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
$successCount = 0
$failed = @()
$warnings = @()

Write-Host "=== Download Gambar Produk dari Wikimedia Commons ==="
Write-Host ("Target: " + $destDir)
Write-Host ""

if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Force -Path $tempDir | Out-Null }

$successCount = 0
$failed = @()
$warnings = @()

$products = @(
    @{ sku="ALK-001"; title="Obat Nyamuk Cair"; search="insect repellent spray bottle indonesia" },
    @{ sku="MIN-001"; title="Air Mineral 600ml"; search="bottled water plastic bottle indonesia" },
    @{ sku="MIN-002"; title="Teh Botol Sosro 450ml"; search="bottled tea drink indonesia" },
    @{ sku="MIN-003"; title="Kopi Kapal Api Sachet"; search="instant coffee sachet indonesia" },
    @{ sku="RT-001"; title="Sabun Mandi Cair 450ml"; search="liquid soap bottle indonesia" },
    @{ sku="RT-002"; title="Deterjen Bubuk 800g"; search="laundry detergent powder box" },
    @{ sku="RT-003"; title="Tisu Basah Saku"; search="wet wipes package" },
    @{ sku="SBK-001"; title="Beras Pandan Wangi 5kg"; search="jasmine rice bag 5kg" },
    @{ sku="SBK-002"; title="Minyak Goreng 1L"; search="cooking oil 1 liter bottle" },
    @{ sku="SBK-003"; title="Gula Pasir 1kg"; search="white sugar 1kg packaging" },
    @{ sku="SBK-004"; title="Tepung Terigu 1kg"; search="wheat flour 1kg bag" },
    @{ sku="SBK-005"; title="Garam Halus 250g"; search="fine salt 250g packaging" },
    @{ sku="SNK-001"; title="Indomie Goreng"; search="indomie goreng instant noodle" },
    @{ sku="SNK-002"; title="Chitato 68g"; search="potato chips packaging" },
    @{ sku="SNK-003"; title="Oreo Sandwich"; search="oreo sandwich cookies packaging" }
)

Write-Host "=== Download Gambar Produk dari Wikimedia Commons ==="
Write-Host "Target: $destDir"
Write-Host ""

if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Force -Path $tempDir | Out-Null }

$successCount = 0
$failed = @()
$warnings = @()

function Get-WikiFile {
    param($query, $license)
    $apiUrl = "https://commons.wikimedia.org/w/api.php"
    $params = @{
        action = 'query'
        list = 'search'
        srsearch = $query
        srlimit = 5
        srnamespace = 6
        format = 'json'
        srprop = 'snippet|title'
    }
    try {
        $encoded = @()
        foreach ($kv in $params.GetEnumerator()) {
            $encoded += "$($kv.Key)=" + [System.Uri]::EscapeDataString($kv.Value)
        }
        $url = "https://commons.wikimedia.org/w/api.php?" + ($encoded -join '&')
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 15 -ErrorAction Stop
        $data = $response.Content | ConvertFrom-Json
        if (-not $data.query.search) { return $null }
        foreach ($item in $data.query.search) {
            $title = $item.title
            $snippet = $item.snippet -join ' '
            $licenseOk = $true
            if ($license -and $license -ne 'any') {
                $licenseOk = $false
                if ($snippet -match 'CC0|public domain') { $licenseOk = $true }
                if ($snippet -match 'CC BY') { $licenseOk = $true }
                if ($snippet -match 'CC BY-SA') { $licenseOk = $true }
            }
            if ($licenseOk -or -not $license -or $license -eq 'any') {
                return "File:$title"
            }
        }
        if ($data.query.search.Count -gt 0) { return "File:$($data.query.search[0].title)" }
    } catch { Write-Warning "Search failed: $($_.Exception.Message)" }
    return $null
}

function Get-ImgInfo {
    param($fileTitle)
    $apiUrl = "https://commons.wikimedia.org/w/api.php"
    $params = @{
        action = 'query'
        titles = $fileTitle
        prop = 'imageinfo'
        iiprop = 'url|size|mime|extmetadata'
        iiurlwidth = 400
        iiurlheight = 400
        format = 'json'
    }
    try {
        $encoded = @()
        foreach ($kv in $params.GetEnumerator()) {
            $encoded += "$($kv.Key)=" + [System.Uri]::EscapeDataString($kv.Value)
        }
        $url = "https://commons.wikimedia.org/w/api.php?" + ($encoded -join '&')
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 15 -ErrorAction Stop
        $data = $response.Content | ConvertFrom-Json
        $page = $data.query.pages.Values[0]
        if ($page.imageinfo) {
            $info = $page.imageinfo[0]
            return @{
                url = $info.url
                width = $info.width
                height = $info.height
                mime = $info.mime
                license = $info.extmetadata.LicenseShort.value
            }
        }
    } catch { Write-Warning "Get image info failed: $($_.Exception.Message)" }
    return $null
}

$destDir = "apps/web/public/images/products"
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
$successCount = 0
$failed = @()
$warnings = @()

Write-Host "=== Download Gambar Produk dari Wikimedia Commons ==="
Write-Host ("Target: " + $destDir)
Write-Host ""

if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Force -Path $tempDir | Out-Null }

$successCount = 0
$failed = @()
$warnings = @()

$products = @(
    @{ sku="ALK-001"; title="Obat Nyamuk Cair"; search="insect repellent spray bottle indonesia" },
    @{ sku="MIN-001"; title="Air Mineral 600ml"; search="bottled water plastic bottle indonesia" },
    @{ sku="MIN-002"; title="Teh Botol Sosro 450ml"; search="bottled tea drink indonesia" },
    @{ sku="MIN-003"; title="Kopi Kapal Api Sachet"; search="instant coffee sachet indonesia" },
    @{ sku="RT-001"; title="Sabun Mandi Cair 450ml"; search="liquid soap bottle indonesia" },
    @{ sku="RT-002"; title="Deterjen Bubuk 800g"; search="laundry detergent powder box" },
    @{ sku="RT-003"; title="Tisu Basah Saku"; search="wet wipes package" },
    @{ sku="SBK-001"; title="Beras Pandan Wangi 5kg"; search="jasmine rice bag 5kg" },
    @{ sku="SBK-002"; title="Minyak Goreng 1L"; search="cooking oil 1 liter bottle" },
    @{ sku="SBK-003"; title="Gula Pasir 1kg"; search="white sugar 1kg packaging" },
    @{ sku="SBK-004"; title="Tepung Terigu 1kg"; search="wheat flour 1kg bag" },
    @{ sku="SBK-005"; title="Garam Halus 250g"; search="fine salt 250g packaging" },
    @{ sku="SNK-001"; title="Indomie Goreng"; search="indomie goreng instant noodle" },
    @{ sku="SNK-002"; title="Chitato 68g"; search="potato chips packaging" },
    @{ sku="SNK-003"; title="Oreo Sandwich"; search="oreo sandwich cookies packaging" }
)

Write-Host "=== Download Gambar Produk dari Wikimedia Commons ==="
Write-Host ("Target: " + $destDir)
Write-Host ""

if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Force -Path $tempDir | Out-Null }

$successCount = 0
$failed = @()
$warnings = @()

function Get-WikiFile {
    param($query, $license)
    $apiUrl = "https://commons.wikimedia.org/w/api.php"
    $params = @{
        action = 'query'
        list = 'search'
        srsearch = $query
        srlimit = 5
        srnamespace = 6
        format = 'json'
        srprop = 'snippet|title'
    }
    try {
        $encoded = @()
        foreach ($kv in $params.GetEnumerator()) {
            $encoded += "$($kv.Key)=" + [System.Uri]::EscapeDataString($kv.Value)
        }
        $url = "https://commons.wikimedia.org/w/api.php?" + ($encoded -join '&')
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 15 -ErrorAction Stop
        $data = $response.Content | ConvertFrom-Json
        if (-not $data.query.search) { return $null }
        foreach ($item in $data.query.search) {
            $title = $item.title
            $snippet = $item.snippet -join ' '
            $licenseOk = $true
            if ($license -and $license -ne 'any') {
                $licenseOk = $false
                if ($snippet -match 'CC0|public domain') { $licenseOk = $true }
                if ($snippet -match 'CC BY') { $licenseOk = $true }
                if ($snippet -match 'CC BY-SA') { $licenseOk = $true }
            }
            if ($licenseOk -or -not $license -or $license -eq 'any') {
                return "File:$title"
            }
        }
        if ($data.query.search.Count -gt 0) { return "File:$($data.query.search[0].title)" }
    } catch { Write-Warning "Search failed: $($_.Exception.Message)" }
    return $null
}

function Get-ImgInfo {
    param($fileTitle)
    $apiUrl = "https://commons.wikimedia.org/w/api.php"
    $params = @{
        action = 'query'
        titles = $fileTitle
        prop = 'imageinfo'
        iiprop = 'url|size|mime|extmetadata'
        iiurlwidth = 400
        iiurlheight = 400
        format = 'json'
    }
    try {
        $encoded = @()
        foreach ($kv in $params.GetEnumerator()) {
            $encoded += "$($kv.Key)=" + [System.Uri]::EscapeDataString($kv.Value)
        }
        $url = "https://commons.wikimedia.org/w/api.php?" + ($encoded -join '&')
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 15 -ErrorAction Stop
        $data = $response.Content | ConvertFrom-Json
        $page = $data.query.pages.Values[0]
        if ($page.imageinfo) {
            $info = $page.imageinfo[0]
            return @{
                url = $info.url
                width = $info.width
                height = $info.height
                mime = $info.mime
                license = $info.extmetadata.LicenseShort.value
            }
        }
    } catch { Write-Warning "Get image info failed: $($_.Exception.Message)" }
    return $null
}

$destDir = "apps/web/public/images/products"
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
$successCount = 0
$failed = @()
$warnings = @()

Write-Host "=== Download Gambar Produk dari Wikimedia Commons ==="
Write-Host ("Target: " + $destDir)
Write-Host ""

if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Force -Path $tempDir | Out-Null }

$successCount = 0
$failed = @()
$warnings = @()

$products = @(
    @{ sku="ALK-001"; title="Obat Nyamuk Cair"; search="insect repellent spray bottle indonesia" },
    @{ sku="MIN-001"; title="Air Mineral 600ml"; search="bottled water plastic bottle indonesia" },
    @{ sku="MIN-002"; title="Teh Botol Sosro 450ml"; search="bottled tea drink indonesia" },
    @{ sku="MIN-003"; title="Kopi Kapal Api Sachet"; search="instant coffee sachet indonesia" },
    @{ sku="RT-001"; title="Sabun Mandi Cair 450ml"; search="liquid soap bottle indonesia" },
    @{ sku="RT-002"; title="Deterjen Bubuk 800g"; search="laundry detergent powder box" },
    @{ sku="RT-003"; title="Tisu Basah Saku"; search="wet wipes package" },
    @{ sku="SBK-001"; title="Beras Pandan Wangi 5kg"; search="jasmine rice bag 5kg" },
    @{ sku="SBK-002"; title="Minyak Goreng 1L"; search="cooking oil 1 liter bottle" },
    @{ sku="SBK-003"; title="Gula Pasir 1kg"; search="white sugar 1kg packaging" },
    @{ sku="SBK-004"; title="Tepung Terigu 1kg"; search="wheat flour 1kg bag" },
    @{ sku="SBK-005"; title="Garam Halus 250g"; search="fine salt 250g packaging" },
    @{ sku="SNK-001"; title="Indomie Goreng"; search="indomie goreng instant noodle" },
    @{ sku="SNK-002"; title="Chitato 68g"; search="potato chips packaging" },
    @{ sku="SNK-003"; title="Oreo Sandwich"; search="oreo sandwich cookies packaging" }
)

Write-Host "=== Download Gambar Produk dari Wikimedia Commons ==="
Write-Host ("Target: " + $destDir)
Write-Host ""

if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
$tempDir = Join-Path $env:TEMP "warung-img-$(Get-Random)"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Force -Path $tempDir | Out-Null }

$successCount = 0
$failed = @()
$warnings = @()

foreach ($p in $products) {
    $sku = $p.sku
    $title = $p.title
    $search = $p.search
    $license = $p.license

    Write-Host "Processing $sku ($title) ... " -NoNewline

    try {
        $fileTitle = Get-WikiFile -query $p.search -license $p.license
        if (-not $fileTitle) { throw "No image found for query: $($p.search)" }

        $imgInfo = Get-ImgInfo -fileTitle $fileTitle
        if (-not $imgInfo -or -not $imgInfo.url) { throw "No image URL found" }

        if ($imgInfo.width -lt 200 -or $imgInfo.height -lt 200) { throw "Image too small ($($imgInfo.width)x$($imgInfo.height))" }

        $tempFile = Join-Path $env:TEMP "warung-$sku.tmp"
        Write-Host "Downloading $sku ... " -NoNewline

        Invoke-WebRequest -Uri $imgInfo.url -OutFile "$sku.tmp" -TimeoutSec 30 -ErrorAction Stop

        $fileInfo = Get-Item "$sku.tmp" -ErrorAction Stop
        if ($fileInfo.Length -lt 5000) { throw "File too small" }

        $destPath = "apps/web/public/images/products/$sku.webp"
        if (Test-Path "apps/web/public/images/products/$sku.webp") {
            Move-Item "apps/web/public/images/products/$sku.webp" "apps/web/public/images/products/$sku.webp.bak" -Force
        }
        Move-Item "$sku.tmp" $destPath -Force

        $fileInfo = Get-Item "apps/web/public/images/products/$sku.webp"
        if ($fileInfo.Length -lt 5000) { throw "Saved file too small" }

        Write-Host " OK ($($fileInfo.Length) bytes)" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host " GAGAL: $($_.Exception.Message)" -ForegroundColor Red
        $failed += $sku
    }
}

Write-Host ""
Write-Host "=== RINGKASAN ==="
Write-Host ("Berhasil: $successCount / 15")
if ($failed.Count -gt 0) {
    Write-Host "Gagal: $($failed -join ', ')" -ForegroundColor Yellow
}

Write-Host ""
Write-Host ("File gambar di " + $destDir + ":")
Get-ChildItem "apps/web/public/images/products" -File | ForEach-Object {
    Write-Host ("  " + $_.Name + " (" + $_.Length + " bytes)")
}