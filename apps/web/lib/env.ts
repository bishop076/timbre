import "server-only";

import { z } from "zod";

/**
 * Server environment, validated once at first use.
 *
 * **Almost empty, and that is the point.** Timbre stores nothing about anyone:
 * playlists, profile and history live in the reader's browser, so there is no
 * database URL, no session secret, no encryption key and no mail server. What
 * is left is the address of the YouTube Music sidecar and the secret shared
 * with it.
 *
 * That is what makes free hosting possible — the app is a stateless front end
 * over public catalogues, with one small service behind it.
 */
const schema = z.object({
  /** The Python sidecar. Loopback by default; never expose it publicly. */
  YTMUSIC_SERVICE_URL: z.url().default("http://127.0.0.1:8787"),
  YTMUSIC_SHARED_SECRET: z
    .string()
    .min(1, "YTMUSIC_SHARED_SECRET must match the sidecar's own value."),

  /**
   * SoundCloud stays optional and unset. Its player needs no credentials at
   * all; only its catalogue search does, and that is gated — see
   * docs/BLOCKED.md.
   */
  SOUNDCLOUD_CLIENT_ID: z.string().optional(),
  SOUNDCLOUD_CLIENT_SECRET: z.string().optional(),

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

/** Whether the centrally-keyed SoundCloud integration is configured. */
export function hasSoundCloud(env: Env): boolean {
  return Boolean(env.SOUNDCLOUD_CLIENT_ID && env.SOUNDCLOUD_CLIENT_SECRET);
}
