'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Tone } from '@cashads/shared';

export interface Celebration {
  id: number;
  amountMicros: number;
  title: string;
  status: 'completed' | 'pending';
  availableAt?: string | null;
  source: string;
}

export interface Toast {
  id: number;
  title: string;
  description?: string;
  tone?: Tone;
  action?: { label: string; href: string };
}

interface UiState {
  celebration: Celebration | null;
  celebrate: (c: Omit<Celebration, 'id'>) => void;
  clearCelebration: () => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  mobileNavOpen: boolean;
  setMobileNav: (open: boolean) => void;
  videoTakenOver: boolean;
  setVideoTakenOver: (v: boolean) => void;
}

let seq = 1;

export const useUi = create<UiState>((set) => ({
  celebration: null,
  celebrate: (c) => set({ celebration: { ...c, id: seq++ } }),
  clearCelebration: () => set({ celebration: null }),
  toasts: [],
  toast: (t) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 6000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  mobileNavOpen: false,
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  videoTakenOver: false,
  setVideoTakenOver: (v) => set({ videoTakenOver: v }),
}));

interface PrefsState {
  theme: 'system' | 'light' | 'dark';
  dataSaver: boolean;
  setTheme: (t: 'system' | 'light' | 'dark') => void;
  setDataSaver: (v: boolean) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      dataSaver: false,
      setTheme: (theme) => set({ theme }),
      setDataSaver: (dataSaver) => set({ dataSaver }),
    }),
    { name: 'ca_prefs' },
  ),
);

export const toast = (t: Omit<Toast, 'id'>) => useUi.getState().toast(t);
