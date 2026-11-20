'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const sdk = require('node-appwrite');

const sourceRoot = path.resolve(__dirname, '../../Central_Placement_Committee_UTU/03 Outreach Templates');
const client = new sdk.Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const tables = new sdk.TablesDB(client);
const databaseId = process.env.APPWRITE_DATABASE_ID;
const categories = new Map([
  ['01_Initial_Company_Outreach', 'GENERAL_OUTREACH'],
  ['02_Follow-ups & Responses', 'FOLLOW_UP'],
  ['03_Recruitment & Internship', 'RECRUITMENT'],
  ['04_EdTech Career Fair', 'EDTECH_CAREER_FAIR'],
  ['05_Post-Recruitment Communication', 'POST_RECRUITMENT'],
]);
function walk(directory, result = []) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); if (entry.isDirectory()) walk(full, result); else if (/\.docx$/i.test(entry.name)) result.push(full); } return result; }
function titleFrom(file) { return path.basename(file, path.extname(file)).replace(/[_-]+/g, ' ').replace(/^\d+\s*/, '').trim(); }
function categoryFrom(file) { return categories.get(path.basename(path.dirname(file))) || 'OTHER'; }
function channelFrom(title) { return /linkedin/i.test(title) ? 'LINKEDIN' : 'EMAIL'; }
function variables(body) { return [...new Set((body.match(/\[[^\]]+\]|\{\{[^}]+\}\}/g) || []).map((value) => value.replace(/^\[|\]$|^\{\{|\}\}$/g, '').trim()).filter(Boolean))].slice(0, 30); }

async function main() {
  const members = await tables.listRows({ databaseId, tableId: 'members', queries: [sdk.Query.equal('login_id', ['tpo_utu']), sdk.Query.limit(1)] });
  const tpo = members.rows[0];
  if (!tpo) throw new Error('TPO_UTU member profile was not found.');
  const existing = await tables.listRows({ databaseId, tableId: 'templates', queries: [sdk.Query.limit(100)] });
  const existingTitles = new Set(existing.rows.map((row) => row.title));
  let created = 0; let skipped = 0;
  for (const file of walk(sourceRoot)) {
    const result = await mammoth.extractRawText({ path: file });
    const body = result.value.trim();
    const title = titleFrom(file);
    if (!body || existingTitles.has(title)) { skipped += 1; continue; }
    const timestamp = new Date().toISOString();
    await tables.createRow(databaseId, 'templates', sdk.ID.unique(), { title, category: categoryFrom(file), channel: channelFrom(title), subject: '', body: body.slice(0, 10000), variables: variables(body), is_active: true, is_archived: false, created_at: timestamp, created_by: tpo.user_id, updated_at: timestamp, updated_by: tpo.user_id });
    existingTitles.add(title); created += 1;
  }
  console.log(JSON.stringify({ templatesCreated: created, templatesSkipped: skipped }, null, 2));
}
main().catch((error) => { console.error(`Template import failed: ${error.message}`); process.exitCode = 1; });
