import React from 'react';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/server/auth';
import { isAdminWallet } from '@/lib/config';
import { getLedgerEntries } from '@/server/db';
import { AdminLedgerTable } from '@/components/admin/AdminLedgerTable';

export default async function AdminLedgerPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    notFound();
  }

  const verified = verifySessionToken(token);
  if (!verified || !isAdminWallet(verified.wallet)) {
    notFound();
  }

  const { entries } = await getLedgerEntries({ limit: 1000, offset: 0, sort: 'newest' });

  return <AdminLedgerTable initialEntries={entries} />;
}

