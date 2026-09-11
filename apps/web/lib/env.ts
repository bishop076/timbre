import "server-only";

import { z } from "zod";

import { queryFlag } from "./query-text";

const schema = z.object({
  YTMUSIC_SERVICE_URL: z.url().default("http://127.0.0.1:8787"),
  YTMUSIC_SHARED_SECRET: z
    .string()
    .min(1, "YTMUSIC_SHARED_SECRET must match the sidecar's own value."),
  SOUNDCLOUD_CLIENT_ID: z.string().optional(),
  SOUNDCLOUD_CLIENT_SECRET: z.string().optional(),
  SOUNDCLOUD_API_BASE: z.url().optional(),
  SOUNDCLOUD_DIRECT_API: queryFlag,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (parsed.success) return (cached = parsed.data);

  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the missing values.`,
  );
}

export function hasSoundCloud(env: Env): boolean {
  return (
    env.SOUNDCLOUD_DIRECT_API ||
    Boolean(env.SOUNDCLOUD_API_BASE || (env.SOUNDCLOUD_CLIENT_ID && env.SOUNDCLOUD_CLIENT_SECRET))
  );
}
