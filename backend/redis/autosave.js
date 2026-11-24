// The Redis side of utils/autosave.js (Pro): answers held between database
// writes. Per attempt: a copy of what saving needs to check (meta), a hash
// of answer fields changed since the last write, a "closed" mark once it's
// handed in, and a short lock while it's written. A set lists the attempts
// with something to write.

const PREFIX = process.env.REDIS_PREFIX || "examai:";
const k = {
  meta: (id) => `${PREFIX}as:m:${id}`,
  answers: (id) => `${PREFIX}as:a:${id}`,
  closed: (id) => `${PREFIX}as:x:${id}`,
  lock: (id) => `${PREFIX}as:l:${id}`,
  dirty: `${PREFIX}as:dirty`,
};
const DAY_S = 24 * 3600;

// Everything changed, and the attempt off the to-write list, in one step.
const TAKE = `
local h = redis.call("HGETALL", KEYS[1])
redis.call("DEL", KEYS[1])
redis.call("SREM", KEYS[2], ARGV[1])
return h`;

const create = (client) => ({
  getMeta: async (id) => {
    const raw = await client.get(k.meta(id));
    return raw ? JSON.parse(raw) : null;
  },
  setMeta: (id, meta, ttlS) => client.set(k.meta(id), JSON.stringify(meta), "EX", Math.max(60, Math.ceil(ttlS))),
  isClosed: async (id) => Boolean(await client.exists(k.closed(id))),
  close: (id) => client.multi().set(k.closed(id), "1", "EX", DAY_S).del(k.meta(id)).exec(),

  // fields: { "<questionId>|<field>": json }, time: { "<questionId>": ms }
  write: async (id, fields, time) => {
    const multi = client.multi();
    const flat = Object.entries(fields).flat();
    if (flat.length) multi.hset(k.answers(id), ...flat);
    for (const [q, ms] of Object.entries(time)) multi.hincrby(k.answers(id), `${q}|timeSpentMs`, ms);
    multi.expire(k.answers(id), DAY_S).sadd(k.dirty, id);
    await multi.exec();
  },
  take: async (id) => {
    const flat = await client.eval(TAKE, 2, k.answers(id), k.dirty, id);
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
    return out;
  },
  // A write that failed goes back without overwriting anything newer.
  putBack: async (id, raw) => {
    const multi = client.multi();
    for (const [field, value] of Object.entries(raw)) {
      if (field.endsWith("|timeSpentMs")) multi.hincrby(k.answers(id), field, Number(value) || 0);
      else multi.hsetnx(k.answers(id), field, value);
    }
    multi.expire(k.answers(id), DAY_S).sadd(k.dirty, id);
    await multi.exec();
  },
  dirty: (limit) => client.srandmember(k.dirty, limit),
  dirtyCount: () => client.scard(k.dirty),
  lock: async (id, ms) => (await client.set(k.lock(id), "1", "PX", ms, "NX")) === "OK",
  unlock: (id) => client.del(k.lock(id)),
});

module.exports = { create };
