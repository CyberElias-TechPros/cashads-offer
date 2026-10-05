import { z } from 'zod';

// Load .env (Node 22 built-in) when present — no dotenv dependency needed.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? def : ['true', '1', 'yes'].includes(v)));

const nodeEnv = (process.env.NODE_ENV ?? 'development') as 'development' | 'test' | 'production';
const isProd = nodeEnv === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default(isProd ? 'info' : 'info'),
  /** Postgres connection string. When absent, an embedded Postgres (PGlite) is used. */
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('.data/pglite'),
  /** Public base URL used in emails. When empty, derived from the incoming request host. */
  APP_URL: z.string().default(''),
  /** 32-byte key (hex or base64) for AES-256-GCM encryption of PII at rest. */
  DATA_ENCRYPTION_KEY: z.string().optional(),
  /** Sandbox mode: simulated offer/ad networks, payout providers and a dev inbox. */
  SANDBOX_MODE: bool(!isProd),
  WORKER_ENABLED: bool(nodeEnv !== 'test'),
  SEED_DEMO: bool(!isProd),
  SERVE_WEB: bool(isProd),
  WEB_DIST_DIR: z.string().default('../web/dist'),
  UPLOAD_DIR: z.string().default('.data/uploads'),
  TRUST_PROXY: bool(true),
  COOKIE_SECURE: bool(isProd),
  METRICS_TOKEN: z.string().optional(),
  API_DOCS: bool(!isProd),
  ADMIN_EMAIL: z.string().default('admin@lucrum.local'),
  ADMIN_PASSWORD: z.string().default('Admin-demo-2026'),
  DEMO_EMAIL: z.string().default('demo@lucrum.local'),
  DEMO_PASSWORD: z.string().default('Demo-earner-2026'),
  /** Optional real payout provider — enables the Paystack adapter for NG bank payouts. */
  PAYSTACK_SECRET_KEY: z.string().optional(),
});

export type Config = z.infer<typeof schema> & { isProd: boolean; isTest: boolean };

export function loadConfig(overrides: Partial<Record<keyof z.infer<typeof schema>, unknown>> = {}): Config {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    if (!cfg.DATA_ENCRYPTION_KEY) throw new Error('DATA_ENCRYPTION_KEY is required in production');
    if (cfg.SANDBOX_MODE) {
      // Allowed (for staging demos) but loudly flagged.
      console.warn('[config] SANDBOX_MODE is enabled in production — no real money will move.');
    }
  }
  return { ...cfg, isProd: cfg.NODE_ENV === 'production', isTest: cfg.NODE_ENV === 'test' };
}
