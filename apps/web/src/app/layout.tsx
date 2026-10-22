import type { Metadata } from 'next';
import './globals.css';
import { CartProvider } from '@/lib/cartStore';

export const metadata: Metadata = {
  title: 'Warung',
  description: 'Aplikasi Web Warung — POS, katalog, dan manajemen piutang',
  manifest: '/manifest.json',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}