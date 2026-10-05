import type { Tone } from '@cashads/shared';

export const riskTone = (r: string): Tone => (r === 'high' ? 'danger' : r === 'medium' ? 'warning' : 'success');
export const statusTone = (s: string): Tone => (s === 'active' ? 'success' : s === 'restricted' ? 'warning' : s === 'banned' ? 'danger' : 'neutral');
