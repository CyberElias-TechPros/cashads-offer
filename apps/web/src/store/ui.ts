import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info' | 'reward';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  amountMicros?: number;
}

export interface Celebration {
  id: number;
  amountMicros: number;
  title: string;
}

type Theme = 'system' | 'light' | 'dark';

interface UIState {
  toasts: Toast[];
  celebrations: Celebration[];
  theme: Theme;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  celebrate: (c: Omit<Celebration, 'id'>) => void;
  endCelebration: (id: number) => void;
  setTheme: (t: Theme) => void;
}

let seq = 0;

function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export const useUI = create<UIState>((set) => ({
  toasts: [],
  celebrations: [],
  theme: ((): Theme => {
    try {
      return (localStorage.getItem('lucrum.theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  })(),
  toast: (t) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
      t.tone === 'error' ? 6500 : 4500,
    );
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  celebrate: (c) => {
    const id = ++seq;
    set((s) => ({ celebrations: [...s.celebrations, { ...c, id }] }));
    setTimeout(() => set((s) => ({ celebrations: s.celebrations.filter((x) => x.id !== id) })), 2600);
  },
  endCelebration: (id) => set((s) => ({ celebrations: s.celebrations.filter((x) => x.id !== id) })),
  setTheme: (theme) => {
    try {
      localStorage.setItem('lucrum.theme', theme);
    } catch {
      /* ignore */
    }
    applyTheme(theme);
    set({ theme });
  },
}));

export const toast = {
  success: (title: string, body?: string) => useUI.getState().toast({ tone: 'success', title, body }),
  error: (title: string, body?: string) => useUI.getState().toast({ tone: 'error', title, body }),
  info: (title: string, body?: string) => useUI.getState().toast({ tone: 'info', title, body }),
};

if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => applyTheme(useUI.getState().theme));
}
