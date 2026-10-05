import type { ReactNode } from 'react';

export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: ReactNode; sections: Array<{ h: string; p: ReactNode[] }> }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">Version 1.0 · last updated {updated}</p>
      <div className="mt-6 rounded-2xl border border-line bg-surface p-5 text-sm text-muted">{intro}</div>
      <div className="mt-10 space-y-8">
        {sections.map((s, i) => (
          <section key={s.h}>
            <h2 className="text-xl font-bold">
              {i + 1}. {s.h}
            </h2>
            <div className="mt-3 space-y-3 leading-relaxed text-muted">
              {s.p.map((p, j) => (
                <p key={j}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-12 text-xs text-subtle">This document is a product template written in plain language. Have it reviewed by qualified counsel in each jurisdiction you operate in before launch.</p>
    </div>
  );
}
