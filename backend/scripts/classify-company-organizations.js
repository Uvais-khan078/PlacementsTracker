'use strict';

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { adminTables, databaseId, sdk } = require('../appwrite');

const sourceRoot = path.resolve(__dirname, '../../Central_Placement_Committee_UTU');
const governmentWorkbooks = [
  '02 Lead Submissions/Internship_Lead_Entry.xlsx',
  '02 Lead Submissions/Cyber_Security/Cyber Internships.xlsx',
];
const apply = process.env.APPLY_ORGANIZATION_CLASSIFICATION === '1';
const timestamp = () => new Date().toISOString();
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
function rowFields(row) {
  const fields = { ...row };
  for (const key of ['$id', '$createdAt', '$updatedAt', '$permissions', '$databaseId', '$tableId', '__targetCategory']) delete fields[key];
  return fields;
}

async function allRows(tableId) {
  const rows = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const result = await adminTables.listRows({ databaseId, tableId, queries: [sdk.Query.limit(100), sdk.Query.offset(offset)] });
    rows.push(...result.rows);
    if (result.rows.length < 100) return rows;
  }
  throw new Error(`${tableId} exceeded the 10,000 row safety cap.`);
}

function readGovernmentNames() {
  const names = new Set();
  for (const relativePath of governmentWorkbooks) {
    const workbook = XLSX.readFile(path.join(sourceRoot, relativePath), { raw: false });
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
      for (const row of rows) {
        const name = row['Company Name'] || row['Name of Company'] || row['Name of Company:'] || row['Organisation Name'] || row['Organization Name'];
        if (clean(name)) names.add(normalize(name));
      }
    }
  }
  return names;
}

async function audit(member, actionType, entityType, entityId, oldValues, newValues, requestId) {
  await adminTables.createRow(databaseId, 'activity_logs', sdk.ID.unique(), {
    actor_user_id: member.user_id,
    actor_role: member.role,
    action_type: actionType,
    entity_type: entityType,
    entity_id: entityId,
    old_values: oldValues ? JSON.stringify(oldValues).slice(0, 2000) : '',
    new_values: newValues ? JSON.stringify(newValues).slice(0, 2000) : '',
    changed_fields: newValues ? Object.keys(newValues) : [],
    occurred_at: timestamp(),
    request_id: requestId,
    source: 'UI',
  });
}

async function applyBatch(member, rows, batchNumber) {
  const started = timestamp();
  const operation = await adminTables.createRow(databaseId, 'bulk_update_operations', sdk.ID.unique(), {
    table_id: 'companies', created_by: member.user_id, status: 'PREPARED',
    total_rows: rows.length, applied_rows: 0, created_at: started, updated_at: started,
  });
  const journals = [];
  for (const row of rows) {
    journals.push(await adminTables.createRow(databaseId, 'bulk_update_rows', sdk.ID.unique(), {
      operation_id: operation.$id,
      record_id: row.$id,
      changed_fields: ['organization_category'],
      old_values: JSON.stringify({ organization_category: row.organization_category ?? null }),
      new_values: '', expected_updated_at: '', status: 'PREPARED', created_at: started,
    }));
  }

  await audit(member, 'BULK_UPDATE_PREPARE', 'bulk_update_operations', operation.$id, null,
    { table_id: 'companies', total_rows: rows.length, classification_batch: batchNumber }, `source-classification-${operation.$id}`);

  const completed = [];
  try {
    for (let index = 0; index < rows.length; index += 1) {
      const original = rows[index];
      const category = original.__targetCategory;
      const updatedAt = timestamp();
      const saved = await adminTables.updateRow(databaseId, 'companies', original.$id, {
        ...rowFields(original), organization_category: category, updated_at: updatedAt, updated_by: member.user_id,
      });
      completed.push({ original, journal: journals[index], category });
      const journal = journals[index];
      const newValues = { organization_category: category };
      await adminTables.updateRow(databaseId, 'bulk_update_rows', journal.$id, {
        ...journal, new_values: JSON.stringify(newValues), expected_updated_at: saved.updated_at || updatedAt, status: 'APPLIED',
      });
      await audit(member, 'UPDATE', 'companies', saved.$id,
        { organization_category: original.organization_category ?? null }, newValues, `source-classification-${operation.$id}`);
    }
    const doneAt = timestamp();
    await adminTables.updateRow(databaseId, 'bulk_update_operations', operation.$id, {
      ...operation, status: 'APPLIED', applied_rows: completed.length, updated_at: doneAt,
    });
    return { operationId: operation.$id, applied: completed.length };
  } catch (error) {
    for (const item of completed.reverse()) {
      const restoredAt = timestamp();
      const restored = await adminTables.updateRow(databaseId, 'companies', item.original.$id, {
        ...rowFields(item.original), updated_at: restoredAt, updated_by: member.user_id,
      });
      await adminTables.updateRow(databaseId, 'bulk_update_rows', item.journal.$id, { ...item.journal, status: 'UNDONE' });
      await audit(member, 'UNDO_BULK_UPDATE', 'companies', restored.$id,
        { organization_category: item.category }, { organization_category: item.original.organization_category ?? null }, `source-classification-${operation.$id}`);
    }
    for (const journal of journals) {
      if (journal.status === 'PREPARED') await adminTables.updateRow(databaseId, 'bulk_update_rows', journal.$id, { ...journal, status: 'UNDONE' });
    }
    const closedAt = timestamp();
    await adminTables.updateRow(databaseId, 'bulk_update_operations', operation.$id, { ...operation, status: 'UNDONE', applied_rows: 0, updated_at: closedAt });
    throw error;
  }
}

async function main() {
  const governmentNames = readGovernmentNames();
  const [companies, members] = await Promise.all([allRows('companies'), allRows('members')]);
  const tpo = members.find((row) => row.login_id?.toLowerCase() === 'tpo_utu' && row.is_active && row.role === 'SUPER_ADMIN');
  if (!tpo) throw new Error('Active TPO_UTU profile was not found.');
  const unmatched = [...governmentNames].filter((name) => !companies.some((company) => normalize(company.company_name) === name));
  if (unmatched.length) throw new Error(`Government workbook organizations missing from the canonical company list: ${unmatched.slice(0, 10).join(', ')}`);
  const changes = companies.map((company) => ({
    ...company,
    __targetCategory: governmentNames.has(normalize(company.company_name)) ? 'GOVERNMENT' : 'PRIVATE',
  })).filter((company) => company.organization_category !== company.__targetCategory);
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    governmentWorkbooks,
    workbookOrganizationNames: governmentNames.size,
    canonicalCompanies: companies.length,
    government: companies.filter((company) => governmentNames.has(normalize(company.company_name))).length,
    private: companies.filter((company) => !governmentNames.has(normalize(company.company_name))).length,
    rowsToUpdate: changes.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) return;
  let applied = 0;
  for (let offset = 0; offset < changes.length; offset += 250) {
    const result = await applyBatch(tpo, changes.slice(offset, offset + 250), Math.floor(offset / 250) + 1);
    applied += result.applied;
    console.log(`Applied ${applied}/${changes.length} category updates (undo operation ${result.operationId}).`);
  }
}

main().catch((error) => {
  console.error(`Organization classification failed: ${error.message}`);
  process.exitCode = 1;
});
