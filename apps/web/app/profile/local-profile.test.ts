import assert from "node:assert/strict";
import { test } from "node:test";

let instance = 0;

/**
 * A browser whose storage answers reads and refuses writes — a full one, a private window with
 * the quota at zero, or one with site data blocked outright.
 */
async function fresh(seed: Record<string, string>, { writable = true } = {}) {
  const backing: Record<string, string> = { ...seed };

  (globalThis as unknown as { window: unknown; document: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing[key] ?? null,
      setItem: (key: string, value: string) => {
        if (!writable) throw new Error("QuotaExceededError");
        backing[key] = value;
      },
      removeItem: (key: string) => {
        delete backing[key];
      },
    },
    location: { protocol: "http:" },
  };
  (globalThis as unknown as { document: unknown }).document = { cookie: "" };

  instance += 1;
  const profile = await import(`./local-profile.ts?instance=${instance}`);
  return { profile, backing };
}

const ID_KEY = "timbre:profile-id";
const NAME_KEY = "timbre:profile-name";

test("the stored name is read even when nothing can be written", async () => {
  // One `try` used to wrap both reads *and* the id's `setItem`, so a browser that could not
  // take the new id returned `{ id: "local", name: null }` — the reader's display name vanished
  // from the heading while sitting intact one key away, and there is no server copy of it.
  const { profile } = await fresh({ [NAME_KEY]: "Bishop" }, { writable: false });

  assert.equal(profile.getDisplayName(), "Bishop");
});

test("a browser that cannot store an id still has one, and the same one all session", async () => {
  const { profile, backing } = await fresh({ [NAME_KEY]: "Bishop" }, { writable: false });

  assert.equal(profile.getDisplayName(), "Bishop");
  assert.equal(backing[ID_KEY], undefined, "nothing was written");
});

test("a first visit mints an id and keeps it", async () => {
  const { profile, backing } = await fresh({});

  assert.equal(profile.getDisplayName(), null);

  const id = backing[ID_KEY];
  assert.equal(typeof id, "string");
  assert.ok(id!.length >= 8);
});

test("an id already stored is never replaced", async () => {
  const { profile, backing } = await fresh({ [ID_KEY]: "kept", [NAME_KEY]: "Bishop" });

  assert.equal(profile.getDisplayName(), "Bishop");
  assert.equal(backing[ID_KEY], "kept");
});
