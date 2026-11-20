'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const sdk = require('node-appwrite');

const sourceRoot = path.resolve(__dirname, '../../Central_Placement_Committee_UTU');
const client = new sdk.Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const tables = new sdk.TablesDB(client);
const databaseId = process.env.APPWRITE_DATABASE_ID;
const SOURCE_LIMIT = 5000;
const dryRun = process.env.IMPORT_DRY_RUN === '1';

const leadSources = ['RESEARCH', 'REFERRAL', 'LINKEDIN', 'WEBSITE', 'EVENT', 'EXISTING_CONTACT', 'OTHER'];
const leadStatuses = ['NEW', 'RESEARCHING', 'READY_TO_CONTACT', 'OUTREACH_STARTED', 'AWAITING_RESPONSE', 'FOLLOW_UP_DUE', 'INTERESTED', 'NOT_INTERESTED', 'INVALID_CONTACT', 'ON_HOLD', 'ARCHIVED'];
const governmentWorkbooks = new Set(['02 Lead Submissions/Internship_Lead_Entry.xlsx', '02 Lead Submissions/Cyber_Security/Cyber Internships.xlsx']);
function organizationCategory(record) { const relative = path.relative(sourceRoot, record.file).split(path.sep).join('/'); return governmentWorkbooks.has(relative) ? 'GOVERNMENT' : 'PRIVATE'; }

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function key(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function email(value) { const result = clean(value).toLowerCase(); return /\S+@\S+\.\S+/.test(result) ? result : ''; }
function phone(value) { return clean(value).slice(0, 40); }
function url(value) { const result = clean(value); return /^https?:\/\//i.test(result) ? result : ''; }
function arrayValue(value) { return clean(value).split(/[,;|\n]/).map(clean).filter(Boolean); }
function isoDate(value) { const result = clean(value); if (!result) return ''; const date = new Date(result); return Number.isNaN(date.getTime()) ? '' : date.toISOString(); }
function get(row, aliases) { const wanted = aliases.map(key); const found = Object.keys(row).find((header) => wanted.includes(key(header))); return found ? clean(row[found]) : ''; }
function sourceNote(file, sheet, rowNumber, extra = '') { return `[Imported ${path.relative(sourceRoot, file)} / ${sheet} row ${rowNumber}]${extra ? ` ${extra}` : ''}`.slice(0, 5000); }
function sourceRowId(record) { const identity = `${path.relative(sourceRoot, record.file)}\0${record.sheet}\0${record.rowNumber}`; return `legacy_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 26)}`; }
function mapStatus(value) { const status = key(value); if (status.includes('interest')) return 'INTERESTED'; if (status.includes('invalid') || status.includes('bounce')) return 'INVALID_CONTACT'; if (status.includes('follow')) return 'FOLLOW_UP_DUE'; if (status.includes('contact')) return 'OUTREACH_STARTED'; if (status.includes('reply') || status.includes('response')) return 'AWAITING_RESPONSE'; if (status.includes('not') || status.includes('reject') || status.includes('no opening')) return 'NOT_INTERESTED'; if (status.includes('hold')) return 'ON_HOLD'; return 'NEW'; }
function mapSource(value) { const source = key(value); if (source.includes('linkedin')) return 'LINKEDIN'; if (source.includes('website') || source.includes('career')) return 'WEBSITE'; if (source.includes('referr')) return 'REFERRAL'; return 'RESEARCH'; }

async function allRows(tableId) {
  const rows = [];
  for (let offset = 0; offset < SOURCE_LIMIT; offset += 100) {
    const result = await tables.listRows({ databaseId, tableId, queries: [sdk.Query.limit(100), sdk.Query.offset(offset)] });
    rows.push(...result.rows);
    if (result.rows.length < 100) break;
  }
  return rows;
}
function walk(directory, result = []) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); if (entry.isDirectory()) walk(full, result); else if (/\.xlsx?$/i.test(entry.name)) result.push(full); } return result; }
function rowRecords(file) {
  const workbook = XLSX.readFile(file, { cellDates: true, raw: false });
  const records = [];
  for (const sheet of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: '', raw: false });
    const headers = matrix[0] || [];
    matrix.slice(1).forEach((cells, index) => {
      if (!cells.some((value) => clean(value))) return;
      const row = {};
      headers.forEach((header, column) => { if (clean(header)) row[String(header)] = cells[column] ?? ''; });
      records.push({ file, sheet, rowNumber: index + 2, row, rawData: { headers, cells } });
    });
  }
  return records;
}
async function createRow(tableId, rowId, data) {
  if (dryRun) return { $id: `dry-${tableId}-${data.normalized_name || data.company_id || rowId}`, ...data };
  return tables.createRow(databaseId, tableId, rowId, data);
}
function normalizeRecord(record) {
  const row = record.row;
  const companyName = get(row, ['Company Name', 'Organisation Name', 'Organization Name', 'Name of Company', 'Name of Company:', 'Company', 'Company Name:']);
  if (!companyName || /^(sr\.? no|s\.? no)$/i.test(companyName)) return null;
  const contactName = get(row, ['Name of the HR', 'HR Name', 'HR name', 'HR Name/Head', 'HR / Contact Person Name', 'Public HR / Recruiter Name', 'HR Name / Contact Person', 'HR name / relevant contact']);
  const workEmail = email(get(row, ['Email', 'Email ID', 'HR Email ID', 'Hr email id:', 'Active Email', 'Public HR / Recruitment Email', 'HR / recruitment email']));
  const location = get(row, ['Location', 'Location / City', 'Company Location', 'Location(s)', 'Company Location']);
  const branches = get(row, ['Target Branches', 'Eligible Branches']);
  const assigned = get(row, ['Assigned To', 'Assigned To (Member)', 'Member', 'Follow-up Owner', 'Lead Generated By', 'Contacted By', 'Lead Added By']);
  const sourceStatus = get(row, ['Current Status', 'Status', 'Reply Status', 'Company Response Received']);
  const website = url(get(row, ['Company Website', 'Website']));
  return { ...record, companyName, normalizedName: key(companyName), contactName, workEmail, phone: phone(get(row, ['Contact (Mobile)', 'Contact Number', 'HR Contact Number', 'Hr Contact number:', 'Phone', 'Public HR / Recruitment Phone', 'Contact number'])), location, branches: arrayValue(branches), assigned, sourceStatus, website, industry: get(row, ['Industry / Sector', 'Industry', 'Manufacturing sector']), role: get(row, ['Job / Internship Role', 'Entry-Level / Internship Opportunity']), responseDate: isoDate(get(row, ['Response Date'])), contactedDate: isoDate(get(row, ['Date Contacted'])), nextFollowup: isoDate(get(row, ['Next Follow-up Date', 'Feedback 2 with follow up date'])), remarks: get(row, ['Remarks', 'Remarks / Follow-up Details', 'Hiring Notes', 'Feedback 1', 'Feedback 2 with follow up date', 'Address the request to', 'Ask the PA/office for']), sourceNote: sourceNote(record.file, record.sheet, record.rowNumber, assigned ? `Original assignment/source label: ${assigned}` : '') };
}

async function main() {
  const memberRows = await allRows('members');
  const tpo = memberRows.find((row) => row.login_id === 'tpo_utu' && row.is_active);
  if (!tpo) throw new Error('Active TPO_UTU member profile was not found.');
  const companies = await allRows('companies');
  const contacts = await allRows('contacts');
  const leads = await allRows('leads');
  const archivedRows = await allRows('legacy_source_rows');
  const sourceRowById = new Map(archivedRows.map((row) => [row.$id, row]));
  const companyByName = new Map(companies.map((row) => [row.normalized_name, row]));
  const companyByWebsite = new Map(companies.filter((row) => row.website).map((row) => [row.website.toLowerCase(), row]));
  const contactKeys = new Map(contacts.map((row) => [`${row.company_id}|${row.normalized_email || key(row.full_name)}`, row]));
  const leadByCompany = new Map(leads.filter((row) => !row.is_archived && row.lead_status !== 'ARCHIVED').map((row) => [row.company_id, row]));
  const stats = { sourceRows: 0, skipped: 0, companiesCreated: 0, companiesReused: 0, contactsCreated: 0, leadsCreated: 0, duplicateRows: 0, rawRowsArchived: 0, rawRowsUnchanged: 0 };

  for (const record of walk(sourceRoot).flatMap(rowRecords)) {
    stats.sourceRows += 1;
    const item = normalizeRecord(record);
    if (!item) stats.skipped += 1;
    let company = item ? (companyByName.get(item.normalizedName) || (item.website && companyByWebsite.get(item.website.toLowerCase()))) : null;
    let contact = null;
    let lead = null;
    const timestamp = new Date().toISOString();
    if (item && !company) {
      company = await createRow('companies', sdk.ID.unique(), { company_name: item.companyName, normalized_name: item.normalizedName, website: item.website, careers_url: '', linkedin_url: '', industry: item.industry, sector: '', organization_type: '', organization_category: organizationCategory(item), city: item.location, state: '', country: 'India', full_address: '', general_email: '', general_phone: '', company_description: item.role, target_branches: item.branches, source_urls: [], source_notes: item.sourceNote, company_status: 'ACTIVE', owner_member_id: tpo.user_id, created_at: timestamp, created_by: tpo.user_id, updated_at: timestamp, updated_by: tpo.user_id, is_archived: false });
      companyByName.set(item.normalizedName, company); if (item.website) companyByWebsite.set(item.website.toLowerCase(), company); stats.companiesCreated += 1;
    } else if (company) stats.companiesReused += 1;
    if (item && (item.contactName || item.workEmail || item.phone)) {
      const contactKey = `${company.$id}|${item.workEmail || key(item.contactName)}`;
      contact = contactKeys.get(contactKey) || null;
      if (!contact) {
        contact = await createRow('contacts', sdk.ID.unique(), { company_id: company.$id, full_name: item.contactName, first_name: '', last_name: '', designation: '', department: '', contact_context: item.remarks, work_email: item.workEmail, normalized_email: item.workEmail, alternate_email: '', phone: item.phone, linkedin_url: '', country: 'India', city: item.location, preferred_channel: item.workEmail ? 'EMAIL' : 'PHONE', is_primary_contact: contacts.filter((row) => row.company_id === company.$id).length === 0, contact_status: 'UNVERIFIED', source_urls: [], source_notes: item.sourceNote, owner_member_id: tpo.user_id, created_at: timestamp, created_by: tpo.user_id, updated_at: timestamp, updated_by: tpo.user_id });
        contactKeys.set(contactKey, contact); stats.contactsCreated += 1;
      } else stats.duplicateRows += 1;
    }
    if (item && !leadByCompany.has(company.$id)) {
      lead = await createRow('leads', sdk.ID.unique(), { company_id: company.$id, lead_source: mapSource(item.assigned), source_details: item.sourceNote, research_notes: [item.remarks, item.role].filter(Boolean).join(' | ').slice(0, 5000), target_department: '', lead_status: mapStatus(item.sourceStatus), priority: 'NORMAL', owner_member_id: tpo.user_id, assigned_member_id: '', last_contacted_at: item.contactedDate, next_followup_at: item.nextFollowup, created_at: timestamp, created_by: tpo.user_id, updated_at: timestamp, updated_by: tpo.user_id, is_archived: false });
      leadByCompany.set(company.$id, lead); stats.leadsCreated += 1;
    } else if (company) lead = leadByCompany.get(company.$id) || null;

    const rowId = sourceRowId(record);
    const rawData = JSON.stringify(record.rawData || record.row);
    if (Buffer.byteLength(rawData, 'utf8') > 5000) throw new Error(`Raw source row exceeds the 5 KB archive limit: ${path.relative(sourceRoot, record.file)} / ${record.sheet} row ${record.rowNumber}`);
    const sourceFile = path.relative(sourceRoot, record.file).replaceAll(path.sep, '/');
    const sourceHash = crypto.createHash('sha256').update(`${sourceFile}\0${record.sheet}\0${record.rowNumber}\0${rawData}`).digest('hex');
    const existingSourceRow = sourceRowById.get(rowId);
    if (dryRun) {
      if (!existingSourceRow || existingSourceRow.source_hash !== sourceHash) stats.rawRowsArchived += 1;
      else stats.rawRowsUnchanged += 1;
    } else if (!existingSourceRow || existingSourceRow.source_hash !== sourceHash) {
      const archived = { source_file: sourceFile, source_sheet: record.sheet, source_row: record.rowNumber, raw_data: rawData, source_hash: sourceHash, company_id: company?.$id || '', contact_id: contact?.$id || '', lead_id: lead?.$id || '', skip_reason: item ? '' : 'Company name missing or invalid.', imported_at: existingSourceRow?.imported_at || timestamp, created_by: tpo.user_id, updated_at: timestamp };
      const saved = existingSourceRow
        ? await tables.updateRow(databaseId, 'legacy_source_rows', rowId, { ...existingSourceRow, ...archived })
        : await tables.createRow(databaseId, 'legacy_source_rows', rowId, archived);
      sourceRowById.set(rowId, saved); stats.rawRowsArchived += 1;
    } else stats.rawRowsUnchanged += 1;
  }
  console.log(JSON.stringify({ dryRun, ...stats }, null, 2));
}

main().catch((error) => { console.error(`Import failed: ${error.message}`); process.exitCode = 1; });
