'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { AdminRole } from '@/lib/admin';

const LINKS = [
  { href: '/admin', label: 'Dashboard', adminOnly: true },
  { href: '/admin/products', label: 'Kelola Produk', adminOnly: true },
  { href: '/admin/categories', label: 'Kelola Kategori', adminOnly: true },
  { href: '/admin/receivables', label: 'Piutang', adminOnly: false },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminNav({ role = 'ADMIN' }: { role?: AdminRole }) {
  const pathname = usePathname();
  const links = role === 'ADMIN' ? LINKS : LINKS.filter((link) => !link.adminOnly);

  return (
    <nav
      className="flex flex-wrap items-center gap-1 rounded-xl bg-white/10 p-1"
      aria-label="Navigasi admin"
    >
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active ? 'bg-white text-[#3f5d43] shadow-sm' : 'text-white/90 hover:bg-white/10'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
