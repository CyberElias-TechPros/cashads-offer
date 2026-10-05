import type { Metadata } from 'next';
import { SampleOffers } from '@/components/marketing/sample-offers';
import { Section } from '@/components/marketing/site-chrome';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Offers & earning potential', description: 'Browse live offers with real payouts and real hourly rates.' };

export default function PublicOffersPage() {
  return (
    <Section eyebrow="Earning potential" title="What you can earn right now" description="Live offers, sorted by hourly rate. Payouts are your share in real money. Sign up to see offers tailored to your country.">
      <SampleOffers limit={24} />
      <div className="mt-10 text-center">
        <ButtonLink href="/signup" size="lg">
          Create a free account to start
        </ButtonLink>
      </div>
    </Section>
  );
}
