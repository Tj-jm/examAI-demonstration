// The Redis side of utils/leaderboard.js (Pro, live mode): one sorted set
// per batch, scored by each student's average best percentage, plus a hash
// of how many exams each has. Built from the database on first view, then
// moved one student at a time as submissions are graded.
//
// A board is keyed by a version, so dropping every board (an exam deleted)
// is one INCR; the old keys expire on their own.

const PREFIX = process.env.REDIS_PREFIX || "examai:";
const TTL_S = 24 * 3600;

const create = (client) => {
  const version = async () => Number(await client.get(`${PREFIX}lbv`)) || 0;
  const keys = async (batchId) => {
    const v = await version();
    const base = `${PREFIX}lb:${v}:${batchId}`;
    return { scores: `${base}:z`, counts: `${base}:c`, built: `${base}:m` };
  };

  const build = async (k, rows) => {
    const multi = client.multi().del(k.scores, k.counts);
    if (rows.length) {
      multi.zadd(k.scores, ...rows.flatMap((r) => [r.avgPercent, String(r._id)]));
      multi.hset(k.counts, ...rows.flatMap((r) => [String(r._id), r.examsCount]));
    }
    multi.set(k.built, "1", "EX", TTL_S).expire(k.scores, TTL_S).expire(k.counts, TTL_S);
    await multi.exec();
  };

  return {
    // rebuild() → every ranked row, best first (the database query).
    read: async (batchId, studentId, rebuild) => {
      const k = await keys(batchId);
      if (!(await client.exists(k.built))) await build(k, await rebuild());
      const me = String(studentId);
      const [[, top], [, total], [, myRank], [, myScore], [, myCount]] = await client
        .multi()
        .zrevrange(k.scores, 0, 9, "WITHSCORES")
        .zcard(k.scores)
        .zrevrank(k.scores, me)
        .zscore(k.scores, me)
        .hget(k.counts, me)
        .exec();
      const ids = [];
      for (let i = 0; i < top.length; i += 2) ids.push(top[i]);
      const counts = ids.length ? await client.hmget(k.counts, ...ids) : [];
      return {
        top: ids.map((id, i) => ({ _id: id, avgPercent: Number(top[i * 2 + 1]), examsCount: Number(counts[i]) || 0, rank: i + 1 })),
        me: myRank === null || myRank === undefined ? null : { _id: me, avgPercent: Number(myScore), examsCount: Number(myCount) || 0, rank: myRank + 1 },
        total: Number(total) || 0,
      };
    },
    // entry: { avgPercent, examsCount }, or null to take the student off.
    update: async (batchId, studentId, entry) => {
      const k = await keys(batchId);
      if (!(await client.exists(k.built))) return; // built fresh on the next view
      const id = String(studentId);
      if (!entry) await client.multi().zrem(k.scores, id).hdel(k.counts, id).exec();
      else await client.multi().zadd(k.scores, entry.avgPercent, id).hset(k.counts, id, entry.examsCount).exec();
    },
    drop: async (batchId) => {
      const k = await keys(batchId);
      await client.del(k.built, k.scores, k.counts);
    },
    dropAll: async () => {
      await client.incr(`${PREFIX}lbv`);
    },
  };
};

module.exports = { create };
