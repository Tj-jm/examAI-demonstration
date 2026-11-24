const crypto = require("crypto");

// AES-256-GCM. Provider API keys are the only thing encrypted at rest, and
// they must survive a restart, so the key comes from ENCRYPTION_KEY rather
// than being generated per process.

const ALGO = "aes-256-gcm";

const getKey = () => Buffer.from(process.env.ENCRYPTION_KEY, "hex");

const encrypt = (plainText) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
};

const decrypt = (payload) => {
  if (!payload) return null;

  const [ivHex, tagHex, dataHex] = String(payload).split(":");
  if (!ivHex || !tagHex || !dataHex) return null;

  try {
    const decipher = crypto.createDecipheriv(
      ALGO,
      getKey(),
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    // wrong ENCRYPTION_KEY, or the value was tampered with
    console.error("Failed to decrypt stored value:", error.message);
    return null;
  }
};

module.exports = { encrypt, decrypt };
