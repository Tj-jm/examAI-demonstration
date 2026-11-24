const {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// One driver for every S3-compatible service: AWS, Cloudflare R2, Wasabi,
// Backblaze B2, DigitalOcean Spaces and MinIO all speak the same protocol.
// The only difference is the endpoint, which is configuration.

let client = null;
let clientKey = null;

const config = () => ({
  endpoint: process.env.S3_ENDPOINT || undefined,
  region: process.env.S3_REGION || "us-east-1",
  bucket: process.env.S3_BUCKET,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
  // R2 and most MinIO installs need this. AWS does not.
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

const getClient = () => {
  const c = config();

  if (!c.bucket || !c.accessKeyId || !c.secretAccessKey) {
    throw new Error(
      "S3 storage is selected but S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are not all set."
    );
  }

  // Rebuilt only when the configuration actually changes.
  const signature = JSON.stringify(c);
  if (!client || clientKey !== signature) {
    client = new S3Client({
      region: c.region,
      ...(c.endpoint ? { endpoint: c.endpoint } : {}),
      forcePathStyle: c.forcePathStyle,
      credentials: {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
      },
    });
    clientKey = signature;
  }

  return { client, bucket: c.bucket, publicBaseUrl: c.publicBaseUrl };
};

const put = async (key, buffer, contentType) => {
  const { client: s3, bucket } = getClient();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return { key };
};

const remove = async (key) => {
  const { client: s3, bucket } = getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

const url = async (key) => {
  const { client: s3, bucket, publicBaseUrl } = getClient();

  // A bucket fronted by a CDN or made public serves a plain url, which is
  // cacheable. Without one, a presigned url is issued instead.
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
  }

  return await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 3600 }
  );
};

const get = async (key) => {
  const { client: s3, bucket } = getClient();
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const exists = async (key) => {
  try {
    const { client: s3, bucket } = getClient();
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
};

// Settings → Connections' test: the bucket answers with these keys.
const check = async () => {
  await getClient().send(new HeadBucketCommand({ Bucket: config().bucket }));
  return { ok: true, message: "The bucket is reachable with these keys." };
};

module.exports = {
  check,
  put,
  remove,
  url,
  exists,
  get,
  name: "s3",
  get isPublic() {
    return Boolean(config().publicBaseUrl);
  },
};
