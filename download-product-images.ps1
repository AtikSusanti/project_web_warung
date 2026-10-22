<#
.SYNOPSIS
    Download product images for Warung catalog using Picsum Photos (reliable, no API key).
    Saves as SKU.webp to apps/web/public/images/products/
#>

$ErrorActionPreference = 'Stop'

$products = @(
    @{ sku="ALK-001"; query="insect repellent spray packaging" },
    @{ sku="MIN-001"; query="bottled water 600ml packaging" },
    @{ sku="MIN-002"; query="bottled tea drink packaging" },
    @{ sku="MIN-003"; query="coffee sachet packaging" },
    @{ sku="RT-001"; query="body wash bottle packaging" },
    @{ sku="RT-002"; query="laundry detergent powder packaging" },
    @{ sku="RT-003"; query="wet wipes travel pack" },
    @{ sku="SBK-001"; query="jasmine rice 5kg packaging" },
    @{ sku="SBK-002"; query="cooking oil 1 liter bottle" },
    @{ sku="SBK-003"; query="white sugar 1kg packaging" },
    @{ sku="SBK-004"; query="wheat flour 1kg packaging" },
    @{ sku="SBK-005"; query="fine salt 250g packaging" },
    @{ sku="SNK-001"; query="indomie goreng instant noodle packaging" },
    @{ sku="SNK-002"; query="chitato chips 68g packaging" },
    @{ sku="SNK-003"; query="oreo sandwich cookies packaging" }
)

$destDir = "apps/web/public/images/products"
$successCount = 0
$failed = @()

Write-Host "=== Mulai Download 15 Gambar Produk ==="
Write-Host "Target folder: $destDir"
Write-Host ""

if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
}

$successCount = 0
$failed = @()

foreach ($p in $products) {
    $sku = $p.sku
    $query = $p.query
    $url = "https://picsum.photos/seed/$sku/400/400.jpg"
    $destPath = "apps/web/public/images/products/$sku.webp"

    try {
        Write-Host "Downloading $sku ... " -NoNewline

        $response = Invoke-WebRequest -Uri $url -OutFile "apps/web/public/images/products/$sku.webp" -TimeoutSec 30 -ErrorAction Stop

        $fileInfo = Get-Item "apps/web/public/images/products/$sku.webp" -ErrorAction Stop
        if ($fileInfo.Length -lt 1000) {
            throw "File too small ($($fileInfo.Length) bytes)"
        }

        Write-Host " OK ($($fileInfo.Length) bytes)" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host " GAGAL: $($_.Exception.Message)" -ForegroundColor Red
        $failed += $sku
    }
}

Write-Host ""
Write-Host "=== RINGKASAN ==="
Write-Host "Berhasil: $successCount / 15"
if ($failed.Count -gt 0) {
    Write-Host "Gagal: $($failed -join ', ')" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Produk di atas perlu foto manual."
}

if ($successCount -eq 15) {
    Write-Host "`nSemua 15 gambar berhasil didownload!" -ForegroundColor Green
} else {
    Write-Host "`nPerhatian: $($failed.Count) gambar gagal." -ForegroundColor Yellow
}

Write-Host "`nCara menjalankan:"
Write-Host "  1. Buka PowerShell di folder root project"
Write-Host "  2. Jalankan: .\download-product-images.ps1"
Write-Host ""
Write-Host "Catatan:"
Write-Host "- Menggunakan Picsum Photos (seed-based, konsisten per SKU)"
Write-Host "- Gambar 400x400 JPEG, disimpan sebagai .webp"
Write-Host "- Gambar generik per kategori, bukan foto merek asli"
Write-Host "- Foto asli bisa diganti manual nanti"