'use strict';

require('dotenv').config();
const sdk = require('node-appwrite');

const email = process.argv[2];
const role = process.argv[3] || 'SUPER_ADMIN';
if (!email || !['SUPER_ADMIN', 'COMMITTEE_MEMBER'].includes(role)) {
  throw new Error('Usage: node scripts/bootstrap-member.js <auth-email> [SUPER_ADMIN|COMMITTEE_MEMBER]');
}

const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);
const users = new sdk.Users(client);
const tables = new sdk.TablesDB(client);
const databaseId = process.env.APPWRITE_DATABASE_ID;

async function main() {
  const result = await users.list({ queries: [sdk.Query.equal('email', [email.toLowerCase()]), sdk.Query.limit(1)] });
  const user = result.users[0];
  if (!user) throw new Error('No Appwrite Auth user exists for that email.');
  const existing = await tables.listRows({ databaseId, tableId: 'members', queries: [sdk.Query.equal('user_id', [user.$id]), sdk.Query.limit(1)] });
  const timestamp = new Date().toISOString();
  const data = { user_id: user.$id, full_name: user.name || email.split('@')[0], email: user.email.toLowerCase(), role, is_active: true, created_at: timestamp, updated_at: timestamp };
  if (existing.rows[0]) {
    await tables.updateRow(databaseId, 'members', existing.rows[0].$id, { ...existing.rows[0], ...data, created_at: existing.rows[0].created_at });
    console.log(`Updated member profile for ${user.email} as ${role}.`);
  } else {
    await tables.createRow(databaseId, 'members', sdk.ID.unique(), data);
    console.log(`Created member profile for ${user.email} as ${role}.`);
  }
}

main().catch((error) => {
  console.error(`Member bootstrap failed: ${error.message}`);
  process.exitCode = 1;
});
