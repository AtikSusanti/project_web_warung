type ProductImageProps = {
  src: string | null;
  alt: string;
  className?: string;
  category?: string;
  sku?: string;
};

function getCategoryEmoji(category?: string): string {
  const cat = category?.toLowerCase() ?? '';
  if (cat.includes('sembako') || cat.includes('beras') || cat.includes('nasi') || cat.includes('gandum')) return '🌾';
  if (cat.includes('minum') || cat.includes('teh') || cat.includes('kopi') || cat.includes('air')) return '☕';
  if (cat.includes('snack') || cat.includes('kue') || cat.includes('cokelat') || cat.includes('biskuit') || cat.includes('oreo') || cat.includes('chitato') || cat.includes('indomie')) return '🍪';
  if (cat.includes('rumah') || cat.includes('dapur') || cat.includes('cuci') || cat.includes('sabun') || cat.includes('deterjen') || cat.includes('tisu')) return '🧴';
  if (cat.includes('obat') || cat.includes('alkes') || cat.includes('kesehatan') || cat.includes('nyamuk')) return '💊';
  if (cat.includes('sayur') || cat.includes('buah') || cat.includes('sayuran') || cat.includes('buah-buahan')) return '🥦';
  if (cat.includes('daging') || cat.includes('ikan') || cat.includes('ayam') || cat.includes('daging')) return '🥩';
  if (cat.includes('telur') || cat.includes('susu') || cat.includes('keju') || cat.includes('yogurt')) return '🥚';
  return '📦';
}

function getLocalImageUrl(sku?: string): string | null {
  if (!sku) return null;
  return `/images/products/${sku}.webp`;
}

export default function ProductImage({ src, alt, className = '', category, sku }: ProductImageProps) {
  // Priority 1: imageUrl from API (if provided)
  if (src) {
    return <img src={src} alt={alt} className={`object-cover ${className}`} />;
  }

  // Priority 2: Local product image by SKU
  const localUrl = getLocalImageUrl(sku);
  if (localUrl) {
    return (
      <img
        src={localUrl}
        alt={alt}
        className={`object-cover ${className}`}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          (e.currentTarget as HTMLImageElement).dataset.failed = 'true';
        }}
      />
    );
  }

  // Priority 3: Emoji placeholder based on category
  const emoji = getCategoryEmoji(category);

  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br from-[#b9cdb4] via-[#9dba9e] to-[#7fa083] ${className}`}
      role="img"
      aria-label={alt}
    >
      <span className="text-4xl md:text-5xl lg:text-6xl" role="img" aria-label={alt}>
        {getCategoryEmoji(category)}
      </span>
    </div>
  );
}