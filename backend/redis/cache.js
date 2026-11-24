// The Redis side of utils/cache.js (Pro): tag versions and entries every
// server shares. Keys are prefixed like the rest of backend/redis/.

const PREFIX = process.env.REDIS_PREFIX || "examai:";
const V = `${PREFIX}cv:`; // tag versions
const E = `${PREFIX}ce:`; // entries
// Versions outlive every entry that embeds them, so a version never resets
// under a live entry (which would bring a stale one back).
const VERSION_TTL_S = 30 * 24 * 3600;

const create = (client) => ({
  kind: "redis",
  versions: async (tags) => (await client.mget(tags.map((t) => V + t))).map((v) => Number(v) || 0),
  get: async (key) => client.get(E + key),
  set: async (key, value, ttlS) => {
    await client.set(E + key, value, "EX", Math.ceil(ttlS));
  },
  touch: async (tags) => {
    const multi = client.multi();
    for (const t of tags) multi.incr(V + t).expire(V + t, VERSION_TTL_S);
    await multi.exec();
  },
  clear: async () => {},
  size: async () => {
    // Counting keys would mean a SCAN over the whole keyspace; the memory
    // used is the useful number and the status page shows it.
    return null;
  },
});

module.exports = { create };
