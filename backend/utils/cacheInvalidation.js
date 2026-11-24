// Mongoose plugin: every write to a collection touches the cache tags that
// collection feeds (utils/cache.js, utils/cacheTags.js).
//
// It hooks every kind of write — save, create, insertMany, bulkWrite,
// updateOne/updateMany/findOneAnd…, deleteOne/deleteMany — so a new bulk
// action in some controller can't forget to invalidate: there is nothing to
// remember. Query writes only know their filter, so a per-document tag
// (batch:<id>) is touched when the filter names the id, and the broad tag
// otherwise.
//
//   schema.plugin(cacheInvalidation, { tags: ({ doc, filter }) => [...] })

const cache = require("./cache");

const QUERY_WRITES = [
  "updateOne", "updateMany", "replaceOne",
  "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete",
  "deleteOne", "deleteMany",
];

// A filter value that names exactly one id: "id", ObjectId, or { $eq: id }.
const single = (value) => {
  if (!value) return null;
  if (typeof value === "string" || value._bsontype === "ObjectId" || value._bsontype === "ObjectID") return String(value);
  if (typeof value === "object" && value.$eq) return String(value.$eq);
  return null;
};

const cacheInvalidation = (schema, { tags }) => {
  const touchFor = (ctx) => {
    let list;
    try {
      list = tags({ ...ctx, single });
    } catch {
      return undefined;
    }
    return cache.touch(list);
  };

  schema.post("save", function (doc) {
    return touchFor({ doc });
  });
  schema.post("deleteOne", { document: true, query: false }, function (doc) {
    return touchFor({ doc });
  });
  schema.post(QUERY_WRITES, { document: false, query: true }, function () {
    return touchFor({ filter: this.getFilter() || {} });
  });
  schema.post("insertMany", function (docs) {
    return touchFor({ docs: [].concat(docs || []) });
  });
  schema.post("bulkWrite", function () {
    return touchFor({ bulk: true });
  });
};

module.exports = cacheInvalidation;
