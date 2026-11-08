import React from 'react';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/server/auth';
import { isAdminWallet } from '@/lib/config';
import { getLedgerEntryById } from '@/server/db';
import { AdminLedgerForm } from '@/components/admin/AdminLedgerForm';

export default async function AdminEditLedgerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    notFound();
  }

  const verified = verifySessionToken(token);
  if (!verified || !isAdminWallet(verified.wallet)) {
    notFound();
  }

  const { id } = await params;
  const entry = await getLedgerEntryById(id);
  if (!entry) {
    notFound();
  }

  return <AdminLedgerForm initialData={entry} isEdit={true} />;
}

