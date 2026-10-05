import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1' || v === 'yes'));

const isProd = process.env.NODE_ENV === 'production';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().default(4000),
  /** postgres://… — when empty, an embedded Postgres (PGlite) is used under DATA_DIR. */
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default('./data'),
  /** 32+ chars. Used to encrypt secrets at rest and sign tokens. REQUIRED in production. */
  APP_SECRET: z.string().min(32).optional(),
  /** Public URL of the web app (fallback when it can't be derived from the request). */
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),
  /** URL the API can use to call itself (sandbox partner postbacks). Defaults to http://127.0.0.1:$API_PORT. */
  INTERNAL_API_URL: z.string().optional(),
  DEMO_MODE: bool(!isProd),
  SEED_ON_START: bool(!isProd),
  WORKER_ENABLED: bool(true),
  RATE_LIMIT_ENABLED: bool(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Comma-separated list of origins allowed to embed the app (CSP frame-ancestors). '*' = any. */
  FRAME_ANCESTORS: z.string().default('*'),
  SANDBOX_NETWORK_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('CashAds <hello@cashads.app>'),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYSTACK_SECRET_KEY: z.string().optional(),
});

export type Config = Omit<z.infer<typeof envSchema>, 'INTERNAL_API_URL'> & { appSecret: string; INTERNAL_API_URL: string };

export function loadConfig(overrides: Partial<Record<keyof z.infer<typeof envSchema>, string>> = {}): Config {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && !env.APP_SECRET) {
    throw new Error('APP_SECRET (32+ chars) is required in production');
  }
  const appSecret = env.APP_SECRET ?? 'dev-only-insecure-secret-change-me-0123456789abcdef';
  return { ...env, appSecret, INTERNAL_API_URL: env.INTERNAL_API_URL ?? `http://127.0.0.1:${env.API_PORT}` };
}
