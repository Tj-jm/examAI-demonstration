// Protected video (backend utils/protectedVideo.js) through hls.js. Before
// playing, the player asks the session route for a fresh link and this
// viewing's secret; every request then uses the newest link (renewed while
// watching), and each key the server sends is unscrambled with that secret.
// Download tools that read the playlist get keys that don't open the chunks.
// admin-panel src/utils/protectedHls.js is a copy; keep the two the same.

const TOKEN = /\/hls\/[A-Za-z0-9_-]+\//;
const KEY = /\/key\/(\d+)/;
const text = new TextEncoder();

const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

const sessionUrl = (url, player) => url.replace(/master\.m3u8(\?.*)?$/, `session?p=${player}`);

const ask = async (url, headers) => {
  const res = await fetch(url, { credentials: "include", headers, cache: "no-store" });
  if (!res.ok) {
    const err = new Error("This video couldn't play.");
    err.code = res.status;
    throw err;
  }
  return res.json();
};

// Starts a viewing: { url (master playlist with the fresh link), loader
// (for hls.js `loader`), stop() }. `masterUrl` already carries ?p=player.
export async function openProtected(Hls, masterUrl, player, headers = {}) {
  if (!globalThis.crypto?.subtle) {
    const err = new Error("Protected videos need a secure (https) page.");
    err.code = "insecure";
    throw err;
  }
  const first = await ask(sessionUrl(masterUrl, player), headers);
  const state = { t: first.t, hmac: null };
  state.hmac = await crypto.subtle.importKey("raw", fromHex(first.s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const fresh = (u) => u.replace(TOKEN, `/hls/${state.t}/`);

  const timer = setInterval(() => {
    ask(sessionUrl(fresh(masterUrl), player), headers).then((d) => { state.t = d.t; }).catch(() => {});
  }, Math.max(60, Number(first.every) || 1200) * 1000);

  const unwrap = async (data, k) => {
    const mask = new Uint8Array(await crypto.subtle.sign("HMAC", state.hmac, text.encode(`examai-hls:${k}`)));
    return new Uint8Array(data).map((b, i) => b ^ mask[i]).buffer;
  };

  const Base = Hls.DefaultConfig.loader;
  class Loader extends Base {
    load(context, config, callbacks) {
      context.url = fresh(context.url);
      const k = KEY.exec(context.url)?.[1];
      if (k === undefined) return super.load(context, config, callbacks);
      return super.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, ctx, details) => {
          unwrap(response.data, k).then(
            (data) => callbacks.onSuccess({ ...response, data }, stats, ctx, details),
            () => callbacks.onError({ code: 0, text: "key" }, ctx, details, stats),
          );
        },
      });
    }
  }

  return { url: fresh(masterUrl), loader: Loader, stop: () => clearInterval(timer) };
}
