import assert from "node:assert/strict";
import { test } from "node:test";

let instance = 0;

/**
 * `getEnv` caches the first parse, so each case gets its own copy of the module. The base is
 * the minimum the schema demands; everything else is the case under test.
 */
async function reading(vars: Record<string, string | undefined>) {
  const before = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SOUNDCLOUD_")) delete process.env[key];
  }
  process.env.YTMUSIC_SHARED_SECRET = "a-secret";
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) process.env[key] = value;
  }

  instance += 1;
  const env = (await import(`./env.ts?instance=${instance}`)) as typeof import("./env.ts");
  try {
    return env.hasSoundCloud(env.getEnv());
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, before);
  }
}

test("SoundCloud counts as configured only where a search can actually be made", async () => {
  // The two settings `lib/providers.ts` passes to the provider.
  assert.equal(await reading({ SOUNDCLOUD_API_BASE: "https://api-v2.soundcloud.com" }), true);
  assert.equal(await reading({ SOUNDCLOUD_DIRECT_API: "1" }), true);

  // A registered app's credentials are the obvious thing to set and nothing reads them: they
  // reach no provider, so search stays off. Reporting them as configured told /api/health and
  // the About page that catalogue search was on when it was not.
  assert.equal(
    await reading({ SOUNDCLOUD_CLIENT_ID: "an-id", SOUNDCLOUD_CLIENT_SECRET: "a-secret" }),
    false,
  );

  assert.equal(await reading({}), false);
});
