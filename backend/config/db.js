const mongoose = require("mongoose");

// Without a connection, mongoose queues each operation and waits. The default
// is ten seconds, which turns a database outage into a server that appears to
// hang rather than one that reports a problem.
mongoose.set("bufferTimeoutMS", Number(process.env.DB_BUFFER_TIMEOUT_MS) || 5000);

// One-time, idempotent: questions saved before multi-board archive support
// carried a single authority/year/paperLabel. Fold them into sources[] and
// drop the old fields. Runs on every start but only touches documents that
// still have the old shape, so after the first run it matches nothing.
const migrateArchiveSources = async (db) => {
  try {
    const questions = db.collection("questions");
    const result = await questions.updateMany(
      { authority: { $exists: true, $ne: null }, sources: { $exists: false } },
      [
        {
          $set: {
            sources: [
              {
                authority: "$authority",
                years: { $cond: [{ $ifNull: ["$year", false] }, ["$year"], []] },
                paperLabel: "$paperLabel",
              },
            ],
          },
        },
        { $unset: ["authority", "year", "paperLabel"] },
      ]
    );
    await questions.dropIndex("authority_1_isPublic_1_status_1_topic_1").catch(() => {});
    if (result.modifiedCount > 0) console.log(`Archive: moved ${result.modifiedCount} question(s) to multi-board sources.`);
  } catch (error) {
    console.error(`Archive sources migration failed: ${error.message}`);
  }
};

// "Newest first" sorts by publishedAt. Questions published before it existed
// get the time they were approved, or created if they never went through
// Review. Cheap once done: afterwards nothing matches.
const backfillPublishedAt = async (db) => {
  try {
    const result = await db.collection("questions").updateMany(
      { status: "published", publishedAt: { $exists: false } },
      [{ $set: { publishedAt: { $ifNull: ["$aiMeta.reviewedAt", "$createdAt"] } } }]
    );
    if (result.modifiedCount) console.log(`Set publish time on ${result.modifiedCount} question(s).`);
  } catch (error) {
    console.error(`Publish-time backfill failed: ${error.message}`);
  }
};

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: Number(process.env.DB_POOL_SIZE) || 20,
      // Fail fast when the database is unreachable instead of hanging for
      // the driver's default 30s.
      serverSelectionTimeoutMS: 10000,
      // Drop a socket that has been silent this long, so one stuck query
      // does not hold a pool slot forever.
      socketTimeoutMS: 60000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
    await migrateArchiveSources(conn.connection.db);
    await backfillPublishedAt(conn.connection.db);
  } catch (error) {
    console.error(`Database connection failed: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
