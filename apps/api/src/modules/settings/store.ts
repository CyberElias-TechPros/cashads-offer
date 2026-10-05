import { usd, type SettingsInput } from '@cashads/shared';
import type { DB } from '../../db/client';
import { settings as settingsTable } from '../../db/schema';

export type Settings = SettingsInput;

export const DEFAULT_SETTINGS: Settings = {
  revenueShareBps: 6000,
  welcomeBonusMicros: usd(0.5),
  referralRefereeBonusMicros: usd(0.5),
  referralReferrerBonusMicros: usd(1),
  referralCommissionBps: 1000,
  referralCommissionMonths: 12,
  planBonusMicros: usd(0.05),
  autoApprovePayoutMaxMicros: usd(50),
  kycSinglePayoutMicros: usd(100),
  kycLifetimeMicros: usd(500),
  maxPayoutsPerDay: 5,
  maxPayoutWeeklyMicros: usd(500),
  requirePhoneForPayout: true,
  holdThresholdMicros: usd(2),
  holdHoursDefault: 24,
  holdHoursHighValue: 72,
  highValueThresholdMicros: usd(10),
  claimSlaHours: 24,
  ticketSlaHours: 24,
  videoCooldownSeconds: 3,
  sandboxPayoutFailureRate: 0.05,
  maintenanceBanner: '',
};

/** Runtime-tunable business rules, cached in memory and editable from the admin console. */
export class SettingsStore {
  private cache: Settings = { ...DEFAULT_SETTINGS };
  private loadedAt = 0;

  constructor(private readonly db: DB) {}

  async load(): Promise<Settings> {
    const rows = await this.db.select().from(settingsTable);
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const row of rows) if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value;
    this.cache = merged as Settings;
    this.loadedAt = Date.now();
    return this.cache;
  }

  /** Synchronous read of the cached settings (refreshed every 30s in the background). */
  get(): Settings {
    if (Date.now() - this.loadedAt > 30_000) void this.load().catch(() => undefined);
    return this.cache;
  }

  async update(patch: Partial<Settings>, actorId: string | null): Promise<Settings> {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
      await this.db
        .insert(settingsTable)
        .values({ key, value: value as never, updatedById: actorId, updatedAt: new Date() })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value: value as never, updatedById: actorId, updatedAt: new Date() } });
    }
    return this.load();
  }
}
