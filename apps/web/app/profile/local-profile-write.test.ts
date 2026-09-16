/**
 * What a display name does when this browser will not take it.
 *
 * The name is the one thing on this page with no copy anywhere else, and it is rendered twice:
 * once on the server from the `timbre-name` cookie, and again after hydration from
 * `localStorage`. Those two are written by the same call, so a refusal that moves only one of
 * them leaves the page saying one name before hydration and another after it.
 *
 * `local-profile.test.ts` covers the reads. These cover the write.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

let instance = 0;

async function fresh(seed: Record<string, string>, { writable = true } = {}) {
  const backing: Record<string, string> = { ...seed };
  const jar = { value: "" };

  (globalThis as unknown as { window: unknown }).window = {
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
    location: { protocol: "https:" },
  };
  (globalThis as unknown as { document: unknown }).document = {
    get cookie() {
      return jar.value;
    },
    set cookie(next: string) {
      jar.value = next;
    },
  };

  instance += 1;
  const profile = await import(`./local-profile.ts?write=${instance}`);
  return { profile, backing, jar };
}

const NAME_KEY = "timbre:profile-name";

test("a name this browser takes is stored, cookied, and reported as saved", async () => {
  const { profile, backing, jar } = await fresh({ "timbre:profile-id": "kept" });

  assert.equal(profile.setDisplayName("Ren Kato"), true);
  assert.equal(backing[NAME_KEY], "Ren Kato");
  assert.match(jar.value, /timbre-name=Ren%20Kato/);
  assert.equal(profile.getDisplayName(), "Ren Kato");
});

test("a name this browser refuses is not written to the cookie either", async () => {
  // The cookie is what profile/page.tsx renders the heading from, and it does not share the
  // quota `localStorage` ran out of — so writing it regardless was the one way to make the
  // server frame disagree with every frame after it.
  const { profile, backing, jar } = await fresh(
    { "timbre:profile-id": "kept", [NAME_KEY]: "Bishop" },
    { writable: false },
  );

  assert.equal(profile.getDisplayName(), "Bishop");
  assert.equal(profile.setDisplayName("Ren Kato"), false);
  assert.equal(backing[NAME_KEY], "Bishop", "the stored name is untouched");
  assert.match(jar.value, /timbre-name=Bishop;/, "and the cookie still says the stored one");
  assert.doesNotMatch(jar.value, /Ren/, "the refused name reached nothing");
});

test("a refused name is not left showing in this tab as though it had saved", async () => {
  // `save()` publishes whether or not storage took the value, which is right for a preference
  // that is live in this tab either way. A name is not that: the next load reads it back from
  // the cookie and from storage, and neither of them moved.
  const { profile } = await fresh(
    { "timbre:profile-id": "kept", [NAME_KEY]: "Bishop" },
    { writable: false },
  );

  profile.setDisplayName("Ren Kato");
  assert.equal(profile.getDisplayName(), "Bishop");
});

test("clearing the name is still allowed when storage is full", async () => {
  // removeItem does not need quota, so emptying the field has to keep working — it is also the
  // one thing a reader out of storage can do to make room.
  const { profile, backing } = await fresh(
    { "timbre:profile-id": "kept", [NAME_KEY]: "Bishop" },
    { writable: false },
  );

  assert.equal(profile.setDisplayName("   "), true);
  assert.equal(backing[NAME_KEY], undefined);
  assert.equal(profile.getDisplayName(), null);
});
