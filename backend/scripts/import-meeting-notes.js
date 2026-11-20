'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mammoth = require('mammoth');
const sdk = require('node-appwrite');

const sourceRoot = path.resolve(__dirname, '../../Central_Placement_Committee_UTU');
const notesRoot = path.join(sourceRoot, '04 Meeting Notes');
const client = new sdk.Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const tables = new sdk.TablesDB(client);
const databaseId = process.env.APPWRITE_DATABASE_ID;

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (/\.docx$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}
function stableId(prefix, value) { return `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`; }
function dateFromText(text, file) {
  const match = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/) || path.basename(file).match(/(\d{1,2})_(\d{1,2})_(\d{4})/);
  if (!match) throw new Error(`A meeting date could not be read from ${path.relative(sourceRoot, file)}.`);
  if (/^\d{1,2}_/.test(match[0])) {
    const [, day, month, year] = match;
    return new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+05:30`).toISOString();
  }
  const date = new Date(`${match[2]} ${match[1]}, ${match[3]} 00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) throw new Error(`The meeting date in ${path.relative(sourceRoot, file)} is invalid.`);
  return date.toISOString();
}
async function getRow(tableId, rowId) {
  try { return await tables.getRow(databaseId, tableId, rowId); }
  catch (error) { if (error.code === 404) return null; throw error; }
}
async function main() {
  const memberResult = await tables.listRows({ databaseId, tableId: 'members', queries: [sdk.Query.equal('login_id', ['tpo_utu']), sdk.Query.equal('is_active', [true]), sdk.Query.limit(1)] });
  const tpo = memberResult.rows[0];
  if (!tpo) throw new Error('Active TPO_UTU profile is required to import meeting notes.');
  const files = walk(notesRoot);
  let created = 0; let updated = 0; let unchanged = 0;
  for (const file of files) {
    const raw = await mammoth.extractRawText({ path: file });
    const content = raw.value.trim();
    if (!content) throw new Error(`Meeting note has no extractable text: ${path.relative(sourceRoot, file)}`);
    const sourcePath = path.relative(sourceRoot, file).replaceAll(path.sep, '/');
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const rowId = stableId('mtg', sourcePath);
    const timestamp = new Date().toISOString();
    const firstDate = content.match(/\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b/);
    const title = `Committee Meeting${firstDate ? ` · ${firstDate[0]}` : ''}`;
    const data = { title, meeting_date: dateFromText(content, file), content, source_filename: path.basename(file), source_path: sourcePath, source_hash: sourceHash, created_at: timestamp, created_by: tpo.user_id, updated_at: timestamp, updated_by: tpo.user_id };
    const existing = await getRow('meeting_notes', rowId);
    if (existing?.source_hash === sourceHash) { unchanged += 1; continue; }
    const saved = existing
      ? await tables.updateRow(databaseId, 'meeting_notes', rowId, { ...existing, ...data, created_at: existing.created_at, created_by: existing.created_by })
      : await tables.createRow(databaseId, 'meeting_notes', rowId, data);
    await tables.createRow(databaseId, 'activity_logs', stableId('mta', `${rowId}:${sourceHash}`), {
      actor_user_id: tpo.user_id, actor_role: tpo.role, action_type: existing ? 'UPDATE' : 'IMPORT', entity_type: 'meeting_notes', entity_id: saved.$id,
      old_values: existing ? JSON.stringify({ source_hash: existing.source_hash }) : '', new_values: JSON.stringify({ title, meeting_date: data.meeting_date, source_filename: data.source_filename, source_hash: sourceHash }),
      changed_fields: ['title', 'meeting_date', 'content', 'source_filename', 'source_hash'], occurred_at: timestamp, request_id: `legacy-import:${rowId}`, source: 'MIGRATION', import_batch_id: '',
    }).catch(async (error) => { if (error.code !== 409) throw error; });
    if (existing) updated += 1; else created += 1;
  }
  console.log(JSON.stringify({ meetingNotesFound: files.length, created, updated, unchanged }, null, 2));
}

main().catch((error) => { console.error(`Meeting note import failed: ${error.message}`); process.exitCode = 1; });
