'use strict';

require('dotenv').config();
const sdk = require('node-appwrite');

const client = new sdk.Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const users = new sdk.Users(client);
const tables = new sdk.TablesDB(client);
const databaseId = process.env.APPWRITE_DATABASE_ID;
const email = 'uvaiswalikhan@gmail.com';

async function main() {
  const userResult = await users.list({ queries: [sdk.Query.equal('email', [email]), sdk.Query.limit(1)] });
  const user = userResult.users[0];
  if (!user) { console.log('Legacy Auth user was already absent.'); return; }
  const memberResult = await tables.listRows({ databaseId, tableId: 'members', queries: [sdk.Query.equal('user_id', [user.$id]), sdk.Query.limit(1)] });
  if (memberResult.rows[0]) await tables.deleteRow(databaseId, 'members', memberResult.rows[0].$id);
  await users.delete(user.$id);
  console.log('Legacy Auth user and member profile deleted.');
}
main().catch((error) => { console.error(`Legacy member deletion failed: ${error.message}`); process.exitCode = 1; });
