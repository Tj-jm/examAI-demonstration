// Short in-memory cache for the one-document settings collections
// (AiConfig, AppSettings). Almost every request reads one of them, and they
// change only when an admin saves the settings page.
//
// The cache holds a plain object. Each get() hydrates a fresh document from
// it, so a caller that changes fields and calls save() never touches what
// other requests see. Any save() clears the cache on this process and tells
// the others (utils/shared.js: through Redis on Pro, so every server drops
// its copy at once). Without that, other processes pick the change up
// within TTL_MS.
// The copy goes through BSON, not structuredClone, so ObjectIds and Dates
// stay real ObjectIds and Dates.
const { BSON } = require("mongoose").mongo;
const shared = require("./shared");

const TTL_MS = Number(process.env.SETTINGS_CACHE_MS ?? 30000);

const attach = (schema, name) => {
  const entries = new Map(); // variant -> { at, data }
  shared.onSettingsChange((changed) => {
    if (changed === name) entries.clear();
  });

  schema.statics.cachedGet = async function (variant, load) {
    const hit = entries.get(variant);
    if (TTL_MS > 0 && hit && Date.now() - hit.at < TTL_MS) {
      return this.hydrate(BSON.deserialize(BSON.serialize(hit.data)));
    }
    const doc = await load();
    if (TTL_MS > 0 && doc) {
      entries.set(variant, { at: Date.now(), data: doc.toObject({ depopulate: true }) });
    }
    return doc;
  };

  schema.statics.clearCache = function () {
    entries.clear();
  };

  schema.post("save", () => shared.settingsChanged(name));
};

module.exports = { attach };
