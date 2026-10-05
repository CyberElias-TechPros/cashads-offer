import { eq } from 'drizzle-orm';
import { DEFAULT_FX_RATES, type Settings, settingsSchema, usd } from '@lucrum/shared';
import type { DB } from '../../db/client';
import { settings as settingsTable } from '../../db/schema';

export const DEFAULT_SETTINGS: Settings = {
  revenueShareBps: 6_000,
  firstTaskBonusMicros: usd(0.25),
  streakBaseMicros: usd(0.01),
  streakStepMicros: usd(0.01),
  streakMaxMicros: usd(0.07),
  planBonusMicros: usd(0.05),
  referralBonusMicros: usd(0.5),
  referralResidualBps: 1_000,
  adDailyCap: 30,
  adComboBps: [10_000, 11_000, 12_500],
  adComboWindowMinutes: 10,
  payoutMaxPerDay: 3,
  kycThresholdMicros: usd(100),
  phoneRequiredAboveMicros: usd(1),
  autoApproveMaxFraudScore: 30,
  blockMinFraudScore: 61,
  claimMinWaitMinutes: 10,
  claimSlaHours: 24,
  claimAutoGoodwillPerMonth: 3,
  reversalPolicy: 'absorb',
  claimSlaAutoApproveMaxMicros: usd(5),
  offerAutoPauseReports: 3,
  fraudIpSignals: true,
  postbackMaxAgeHours: 72,
  maintenanceMode: false,
  fxRates: DEFAULT_FX_RATES,
  sandboxPostbackDelayMs: 1_500,
  sandboxProviderOutages: {},
};

const KEY = 'platform';

/** Typed, validated, cached platform settings (admin-editable at runtime). */
export class SettingsStore {
  private current: Settings;

  constructor(private readonly defaults: Settings = DEFAULT_SETTINGS) {
    this.current = structuredClone(defaults);
  }

  get(): Settings {
    return this.current;
  }

  getDefaults(): Settings {
    return this.defaults;
  }

  async load(db: DB): Promise<Settings> {
    const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, KEY));
    const stored = rows[0]?.value ?? {};
    const merged = { ...this.defaults, ...stored };
    const parsed = settingsSchema.safeParse(merged);
    this.current = parsed.success ? parsed.data : structuredClone(this.defaults);
    return this.current;
  }

  async update(
    db: DB,
    patch: Partial<Settings>,
    actorId: string | null,
  ): Promise<{ before: Settings; after: Settings }> {
    const before = this.current;
    const after = settingsSchema.parse({ ...before, ...patch });
    if (after.blockMinFraudScore <= after.autoApproveMaxFraudScore) {
      throw new Error('blockMinFraudScore must be greater than autoApproveMaxFraudScore');
    }
    await db
      .insert(settingsTable)
      .values({ key: KEY, value: after as unknown as Record<string, unknown>, updatedBy: actorId })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: {
          value: after as unknown as Record<string, unknown>,
          updatedAt: new Date(),
          updatedBy: actorId,
        },
      });
    this.current = after;
    return { before, after };
  }

  /** Test helper — mutate without persisting. */
  override(patch: Partial<Settings>): void {
    this.current = { ...this.current, ...patch };
  }
}
