import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/legal';

export const metadata: Metadata = { title: 'Cookie Policy' };

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      updated="October 1, 2026"
      intro="We use as few cookies as possible, and none for advertising."
      sections={[
        { h: 'Strictly necessary', p: ['ca_session: keeps you signed in (httpOnly, secure, 30 days). Required for the service to work.'] },
        { h: 'Functional', p: ['ca_ref: remembers who invited you for 30 days, so your friend gets credit. ca_prefs (local storage): theme and data-saver preferences. ca_device (local storage): a random id used for fraud prevention.'] },
        { h: 'Analytics & advertising', p: ['None. Product analytics are computed server-side from our own database, in aggregate.'] },
      ]}
    />
  );
}
