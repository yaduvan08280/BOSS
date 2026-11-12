import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  APP_NAME: z.string().default('MONO'),
  BASE_URL: z.url().default('http://localhost:5173'),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  DATABASE_URL: z.string().startsWith('postgres'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  /** GST lookup provider (CLAUDE.md §12). Empty = offline checksum check only. */
  GST_API_PROVIDER: z.string().default(''),
  GST_API_KEY: z.string().default(''),
  // Optional server-wide channel defaults (a company's own settings in Integration win).
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default(''),
  /** Login attempts allowed per IP per 15 minutes. */
  LOGIN_RATE_LIMIT: z.coerce.number().int().default(10),
  /**
   * API calls allowed per minute for one signed-in person or API key (and for one IP's requests that are not signed
   * in), on top of each route's own limit. Empty = 600 in production, off elsewhere; 0 = off.
   */
  API_RATE_LIMIT: z.string().default(''),
  /** All signed-in API calls allowed per minute from one IP (a whole office). Empty = 10 × API_RATE_LIMIT; 0 = no total. */
  API_RATE_LIMIT_IP: z.string().default(''),
  /** Let webhooks call private / local addresses (development and tests only; never in production). */
  WEBHOOK_ALLOW_PRIVATE: z
    .string()
    .default('')
    .transform((v) => /^(1|true|yes)$/i.test(v.trim())),
});

export type Env = z.infer<typeof envSchema> & { cookieSecure: boolean; origin: string };

let cached: Env | undefined;

/** Validate process.env once; exits with a readable list of problems instead of failing later. */
/**
 * A relative path means "from the project root", never from wherever a process was started.
 * (In development the api and the worker start in different folders; a plain relative UPLOAD_DIR
 * gave them two separate upload folders, so neither could see the other's files.)
 */
export function fromProjectRoot(path: string, start = process.cwd()): string {
  if (isAbsolute(path)) return path;
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && 'workspaces' in (JSON.parse(readFileSync(pkg, 'utf8')) as object))
      return join(dir, path);
    if (dirname(dir) === dir) return resolve(start, path);
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${lines}`);
  }
  const url = new URL(parsed.data.BASE_URL);
  const env = {
    ...parsed.data,
    UPLOAD_DIR: fromProjectRoot(parsed.data.UPLOAD_DIR),
    cookieSecure: url.protocol === 'https:',
    origin: url.origin,
  };
  if (source === process.env) cached = env;
  return env;
}
