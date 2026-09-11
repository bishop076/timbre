import "server-only";

import { z } from "zod";

const schema = z.object({
  YTMUSIC_SERVICE_URL: z.url().default("http://127.0.0.1:8787"),
  YTMUSIC_SHARED_SECRET: z
    .string()
    .min(1, "YTMUSIC_SHARED_SECRET must match the sidecar's own value."),

  SOUNDCLOUD_CLIENT_ID: z.string().optional(),
  SOUNDCLOUD_CLIENT_SECRET: z.string().optional(),

  SOUNDCLOUD_API_BASE: z.url().optional(),
  SOUNDCLOUD_DIRECT_API: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => value === "true" || value === "1"),

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

export function hasSoundCloud(env: Env): boolean {
  if (env.SOUNDCLOUD_DIRECT_API) return true;
  if (env.SOUNDCLOUD_API_BASE) return true;
  return Boolean(env.SOUNDCLOUD_CLIENT_ID && env.SOUNDCLOUD_CLIENT_SECRET);
}
