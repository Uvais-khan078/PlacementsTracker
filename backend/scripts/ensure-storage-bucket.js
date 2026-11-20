'use strict';

require('dotenv').config();
const sdk = require('node-appwrite');

const endpoint = (process.env.APPWRITE_ENDPOINT || '').replace(/\/$/, '');
const projectId = process.env.APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const buckets = [
  { bucketId: process.env.APPWRITE_RECRUITMENT_BUCKET_ID || process.env.APPWRITE_STORAGE_BUCKET_ID || 'recruitment-documents', name: 'UKTech Recruitment Documents', description: 'Private company, opportunity, application and committee evidence. Access is mediated by the authenticated backend.' },
];

if (!endpoint || !projectId || !apiKey) throw new Error('APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY are required.');

async function ensureBucket(storage, { bucketId, name, description }) {
  const bucketConfig = {
    bucketId,
    name,
    permissions: [],
    fileSecurity: true,
    enabled: true,
    maximumFileSize: 20 * 1024 * 1024,
    allowedFileExtensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg'],
    encryption: true,
    antivirus: true,
    description,
  };
  try {
    const existing = await storage.getBucket({ bucketId });
    const permissions = existing.$permissions || existing.permissions || [];
    const safe = existing.fileSecurity && permissions.length === 0 && existing.enabled && existing.encryption;
    if (!safe) throw new Error(`Bucket ${bucketId} exists but does not match private file-security requirements; refusing to modify it automatically.`);
    console.log(`Verified private bucket ${bucketId}: file security enabled, no public permissions, encryption enabled.`);
    return;
  } catch (error) {
    if (error.code !== 404 && error.code !== 401 && error.code !== 403) throw error;
    if (error.code !== 404) console.log(`Bucket read is not allowed (${error.code}); attempting create with a dedicated bucket ID.`);
  }
  try {
    const created = await storage.createBucket(bucketConfig);
    console.log(`Created private bucket ${created.$id}: file security enabled, no public permissions, encryption enabled.`);
  } catch (error) {
    if (error.code === 409) throw new Error(`Bucket ${bucketId} already exists but cannot be read with this API key; grant buckets.read to verify its security settings.`);
    if (error.code === 401 || error.code === 403) throw new Error(`Appwrite rejected private bucket creation (${error.code}). Grant the API key buckets.write; buckets.read is required for verification.`);
    throw error;
  }
}

async function main() {
  const client = new sdk.Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const storage = new sdk.Storage(client);
  for (const bucket of buckets) await ensureBucket(storage, bucket);
}

main().catch((error) => {
  console.error(`Storage setup failed: ${error.message}`);
  process.exitCode = 1;
});
