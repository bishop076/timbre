import assert from "node:assert/strict";
import { test } from "node:test";

const KEY = "timbre:history";
const CID = "baeaaaiqsecd464n7qxtqqo67upgngf2fcajvoo34d77qqipyxnu2vpqazrwom";

let instance = 0;

async function fresh(seed: Record<string, string> = {}) {
  const backing = { ...seed };

  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing[key] ?? null,
      setItem: (key: string, value: string) => {
        backing[key] = value;
      },
      removeItem: (key: string) => {
        delete backing[key];
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };

  instance += 1;
  return (await import(`./history-store.ts?instance=${instance}`)) as typeof import("./history-store.ts");
}

const entry = (artworkUrl: string | null) => ({
  id: "audius:abc",
  title: "Delilah",
  artists: ["Someone"],
  artworkUrl,
  videoId: null,
});

test("a cover already stored on a third-party host is not drawn from it again", async () => {
  // Written before the Audius rewrite existed, so it names a community content node.
  const stale = entry(`https://audius-creator-7.theblueprint.xyz/content/${CID}/480x480.jpg`);
  const history = await fresh({ [KEY]: JSON.stringify([stale]) });

  const [read] = history.getHistorySnapshot();
  assert.equal(read?.artworkUrl, `https://api.audius.co/content/${CID}/480x480.jpg`);
});

test("a cover on a host the proxy never serves is dropped, and the song kept", async () => {
  const planted = entry("https://evil.example/beacon.png");
  const history = await fresh({ [KEY]: JSON.stringify([planted]) });

  const [read] = history.getHistorySnapshot();
  assert.equal(read?.title, "Delilah");
  assert.equal(read?.artworkUrl, null);
});

test("a cover the proxy does serve is left exactly as it was", async () => {
  const good = entry("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
  const history = await fresh({ [KEY]: JSON.stringify([good]) });

  assert.equal(
    history.getHistorySnapshot()[0]?.artworkUrl,
    "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
  );
});
