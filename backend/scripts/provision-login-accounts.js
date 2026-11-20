'use strict';

require('dotenv').config();
const sdk = require('node-appwrite');

const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);
const users = new sdk.Users(client);
const tables = new sdk.TablesDB(client);
const databaseId = process.env.APPWRITE_DATABASE_ID;
const password = process.env.INITIAL_MEMBER_PASSWORD || 'utu_2026';
const accounts = [
  { loginId: 'TPO_UTU', name: 'TPO UTU', role: 'SUPER_ADMIN' },
  { loginId: 'TNP_CELL_UTU', name: 'TNP CELL UTU', role: 'SUPER_ADMIN' },
  ...Array.from({ length: 6 }, (_, index) => ({ loginId: `MEMBER_${index + 1}`, name: `Member ${index + 1}`, role: 'COMMITTEE_MEMBER' })),
];

function internalEmail(loginId) { return `${loginId.toLowerCase()}@accounts.uktech.local`; }

async function findUser(email) {
  const result = await users.list({ queries: [sdk.Query.equal('email', [email]), sdk.Query.limit(1)] });
  return result.users[0] || null;
}

async function main() {
  for (const account of accounts) {
    const email = internalEmail(account.loginId);
    let user = await findUser(email);
    if (!user) {
      user = await users.create({ userId: account.loginId.toLowerCase(), email, password, name: account.name });
    }
    const existing = await tables.listRows({ databaseId, tableId: 'members', queries: [sdk.Query.equal('user_id', [user.$id]), sdk.Query.limit(1)] });
    const timestamp = new Date().toISOString();
    const previous = existing.rows[0];
    const data = {
      login_id: account.loginId.toLowerCase(),
      user_id: user.$id,
      full_name: previous?.full_name || user.name || account.name,
      email: user.email.toLowerCase(),
      role: account.role,
      is_active: true,
      must_change_credentials: previous?.must_change_credentials === false ? false : true,
      ...(previous?.permissions_json ? { permissions_json: previous.permissions_json } : {}),
      created_at: previous?.created_at || timestamp,
      updated_at: timestamp,
    };
    if (existing.rows[0]) await tables.updateRow(databaseId, 'members', existing.rows[0].$id, { ...existing.rows[0], ...data });
    else await tables.createRow(databaseId, 'members', sdk.ID.unique(), data);
    console.log(`Ready: ${account.loginId} (${account.role})`);
  }
  console.log('Login accounts provisioned. Initial password is configured locally and should be changed after first login.');
}

main().catch((error) => {
  console.error(`Login account provisioning failed: ${error.message}`);
  process.exitCode = 1;
});
