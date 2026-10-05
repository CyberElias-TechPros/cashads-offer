import type { Metadata } from 'next';
import { AppShell } from '@/components/app/shell';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } };

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
