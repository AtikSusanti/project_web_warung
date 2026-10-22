'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';

import Header from '@/components/Header';
import {
  type AdminRole,
  type AdminSession,
  clearAdminSession,
  DEFAULT_ADMIN_ROLES,
  loadAdminSession,
  loginAdmin,
} from '@/lib/admin';

import AdminNav from './AdminNav';

type AdminGateProps = {
  title: string;
  description: string;
  allowedRoles?: readonly AdminRole[];
  children: (context: {
    session: AdminSession;
    expireSession: (message?: string) => void;
  }) => ReactNode;
};

export default function AdminGate({
  title,
  description,
  allowedRoles = DEFAULT_ADMIN_ROLES,
  children,
}: AdminGateProps) {
  const allowsCashier = allowedRoles.includes('CASHIER');
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSession(loadAdminSession(allowedRoles));
    setHydrated(true);
  }, [allowedRoles]);

  const resetLogin = (message: string | null) => {
    clearAdminSession();
    setSession(null);
    setPassword('');
    setAuthError(message);
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError(null);
    setSubmitting(true);
    try {
      const next = await loginAdmin(username, password, allowedRoles);
      setSession(next);
      setPassword('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Terjadi kesalahan saat login');
    } finally {
      setSubmitting(false);
    }
  };

  if (!hydrated) {
    return (
      <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
        <Header />
        <section className="mx-auto max-w-6xl px-4 py-10">
          <div className="rounded-2xl border border-[#e6ddc8] bg-white p-8 text-center text-[#8a8f7d]">
            Memuat...
          </div>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
        <Header />
        <section className="mx-auto max-w-md px-4 py-12">
          <div className="rounded-2xl border border-[#e6ddc8] bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-[#5c7a5f]">
              {allowsCashier ? 'Area Piutang' : 'Area Admin'}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-[#8a8f7d]">
              {allowsCashier
                ? 'Masuk dengan akun admin atau kasir untuk mengelola piutang.'
                : 'Masuk dengan akun admin untuk mengelola data toko.'}
            </p>

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="admin-username"
                  className="mb-1 block text-sm font-medium text-[#8a8f7d]"
                >
                  Username
                </label>
                <input
                  id="admin-username"
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-4 py-3 text-[#26332a] placeholder:text-[#8a8f7d] focus:border-[#5c7a5f] focus:outline-none"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="admin-password"
                  className="mb-1 block text-sm font-medium text-[#8a8f7d]"
                >
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-[#e6ddc8] bg-[#faf6ee] px-4 py-3 text-[#26332a] placeholder:text-[#8a8f7d] focus:border-[#5c7a5f] focus:outline-none"
                  required
                />
              </div>

              {authError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-[#5c7a5f] py-3 font-semibold text-white transition hover:bg-[#4c6b4f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Memproses...' : 'Masuk'}
              </button>
            </form>

            <Link
              href="/admin"
              className="mt-4 block text-center text-sm text-[#5c7a5f] hover:underline"
            >
              Kembali ke dashboard
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#faf6ee] text-[#26332a]">
      <Header />
      <section className="bg-gradient-to-r from-[#7fa083] to-[#5c7a5f]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
            <p className="mt-2 text-white/90">{description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AdminNav role={session.role} />
            <span className="rounded-full bg-white/15 px-3 py-1 text-sm text-white">
              Masuk sebagai {session.username}
            </span>
            <button
              onClick={() => resetLogin(null)}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#3f5d43] shadow-sm transition hover:bg-[#eef4ea]"
            >
              Keluar
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        {children({
          session,
          expireSession: (message) =>
            resetLogin(message ?? 'Sesi berakhir atau akses ditolak. Silakan login lagi.'),
        })}
      </section>
    </main>
  );
}
