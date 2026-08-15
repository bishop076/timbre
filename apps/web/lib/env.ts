import "server-only";

import { z } from "zod";

// Server environment, validated once at first use. Almost empty by design: playlists,
// profile and history live in the reader's browser, so there is no database URL, session
// secret or mail server — only the sidecar's address and its shared secret.
const schema = z.object({
  /** The Python sidecar. Loopback by default; never expose it publicly. */
  YTMUSIC_SERVICE_URL: z.url().default("http://127.0.0.1:8787"),
  YTMUSIC_SHARED_SECRET: z
    .string()
    .min(1, "YTMUSIC_SHARED_SECRET must match the sidecar's own value."),

  /** Optional and unset: only SoundCloud's catalogue search needs credentials, and
   * that is gated — see docs/BLOCKED.md. */
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
