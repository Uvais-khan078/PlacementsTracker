'use strict';

require('dotenv').config();
const sdk = require('node-appwrite');
const client = new sdk.Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const tables = new sdk.TablesDB(client);
const databaseId = process.env.APPWRITE_DATABASE_ID;
const removable = ['jd_document_id', 'jd_received_at', 'form_floated_at', 'eligible_branches', 'eligible_years'];

async function main() {
  const rows = await tables.listRows({ databaseId, tableId: 'opportunities', queries: [sdk.Query.limit(1)] });
  if (rows.total !== 0) throw new Error('Opportunity table contains data; refusing schema compaction.');
  const columns = await tables.listColumns({ databaseId, tableId: 'opportunities' });
  for (const key of removable) {
    if (columns.columns.some((column) => column.key === key)) {
      await tables.deleteColumn(databaseId, 'opportunities', key);
      console.log(`Removed unused empty column: ${key}`);
    }
  }
}

main().catch((error) => { console.error(`Opportunity schema compaction failed: ${error.message}`); process.exitCode = 1; });
