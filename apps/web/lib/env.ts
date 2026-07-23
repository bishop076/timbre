import "server-only";

import { z } from "zod";

/**
 * Server environment, validated once at first use.
 *
 * Timbre stores third-party OAuth tokens, so a missing encryption key or a
 * half-configured deployment must fail at boot with a readable message rather
 * than at 2am inside a sync job.
 */
const schema = z.object({
  DATABASE_URL: z.url({ error: "DATABASE_URL must be a postgres:// connection string." }),

  /** base64, 32 bytes. Generate with `openssl rand -base64 32`. */
  TIMBRE_ENCRYPTION_KEY: z
    .string()
    .min(1, "TIMBRE_ENCRYPTION_KEY is required to encrypt provider tokens."),

  /** Auth.js session signing key. `npx auth secret` generates one. */
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required."),
  AUTH_URL: z.url().optional(),

  /** The Python sidecar. Loopback by default; never expose it publicly. */
  YTMUSIC_SERVICE_URL: z.url().default("http://127.0.0.1:8787"),
  YTMUSIC_SHARED_SECRET: z
    .string()
    .min(1, "YTMUSIC_SHARED_SECRET must match the sidecar's own value."),

  /**
   * SoundCloud is the one provider Timbre keys centrally, because self-service
   * registration reopened in May 2026. Optional so the app still boots with
   * SoundCloud simply unavailable.
   */
  SOUNDCLOUD_CLIENT_ID: z.string().optional(),
  SOUNDCLOUD_CLIENT_SECRET: z.string().optional(),

  /**
   * Magic-link sign-in. Optional so local development can run without SMTP;
   * when absent, Timbre has no usable sign-in method and says so explicitly.
   */
  EMAIL_SERVER: z.string().optional(),
  EMAIL_FROM: z.email().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the missing values.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Whether magic-link sign-in is configured. */
export function hasEmailAuth(env: Env): boolean {
  return Boolean(env.EMAIL_SERVER && env.EMAIL_FROM);
}

/** Whether the centrally-keyed SoundCloud integration is configured. */
export function hasSoundCloud(env: Env): boolean {
  return Boolean(env.SOUNDCLOUD_CLIENT_ID && env.SOUNDCLOUD_CLIENT_SECRET);
}
