'use strict';

require('dotenv').config();
const sdk = require('node-appwrite');

const endpoint = (process.env.APPWRITE_ENDPOINT || '').replace(/\/$/, '');
const projectId = process.env.APPWRITE_PROJECT_ID;
const databaseId = process.env.APPWRITE_DATABASE_ID;
const apiKey = process.env.APPWRITE_API_KEY;

if (!endpoint || !projectId || !databaseId || !apiKey) {
  throw new Error('APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_DATABASE_ID and APPWRITE_API_KEY are required.');
}

const tables = {
  app_settings: [
    ['setting_key', 'string', { size: 80, required: true }],
    ['details_json', 'string', { size: 10000, required: true }],
    ['updated_at', 'datetime', { required: true }],
    ['updated_by', 'string', { size: 36, required: true }],
  ],
  members: [
    ['login_id', 'string', { size: 40 }],
    ['user_id', 'string', { size: 36, required: true }],
    ['full_name', 'string', { size: 160, required: true }],
    ['email', 'string', { size: 320, required: true }],
    ['role', 'string', { size: 32, required: true }],
    ['is_active', 'boolean', { required: true, default: true }],
    ['permissions_json', 'string', { size: 4000 }],
    ['created_at', 'datetime', { required: true }],
    ['updated_at', 'datetime', { required: true }],
  ],
  meeting_notes: [
    ['title', 'string', { size: 200, required: true }],
    ['meeting_date', 'datetime', { required: true }],
    ['content', 'string', { size: 20000, required: true }],
    ['source_filename', 'string', { size: 255, required: true }],
    ['source_path', 'string', { size: 500, required: true }],
    ['source_hash', 'string', { size: 64, required: true }],
    ['created_at', 'datetime', { required: true }],
    ['created_by', 'string', { size: 36, required: true }],
    ['updated_at', 'datetime', { required: true }],
    ['updated_by', 'string', { size: 36, required: true }],
  ],
  legacy_source_rows: [
    ['source_file', 'string', { size: 500, required: true }],
    ['source_sheet', 'string', { size: 120, required: true }],
    ['source_row', 'integer', { required: true }],
    ['raw_data', 'string', { size: 5000, required: true }],
    ['source_hash', 'string', { size: 64, required: true }],
    ['company_id', 'string', { size: 36 }],
    ['contact_id', 'string', { size: 36 }],
    ['lead_id', 'string', { size: 36 }],
    ['skip_reason', 'string', { size: 200 }],
    ['imported_at', 'datetime', { required: true }],
    ['created_by', 'string', { size: 36, required: true }],
    ['updated_at', 'datetime', { required: true }],
  ],
  companies: [
    ['company_name', 'string', { size: 200, required: true }],
    ['normalized_name', 'string', { size: 220, required: true }],
    ['website', 'string', { size: 500 }],
    ['careers_url', 'string', { size: 500 }],
    ['linkedin_url', 'string', { size: 500 }],
    ['industry', 'string', { size: 120 }],
    ['sector', 'string', { size: 120 }],
    ['organization_type', 'string', { size: 120 }],
    ['organization_category', 'string', { size: 32 }],
    ['city', 'string', { size: 100 }],
    ['state', 'string', { size: 100 }],
    ['country', 'string', { size: 100, required: true, default: 'India' }],
    ['full_address', 'string', { size: 500 }],
    ['general_email', 'string', { size: 320 }],
    ['general_phone', 'string', { size: 40 }],
    ['company_description', 'string', { size: 5000 }],
    ['target_branches', 'string', { size: 2000, array: true }],
    ['source_urls', 'string', { size: 2000, array: true }],
    ['source_notes', 'string', { size: 5000 }],
    ['company_status', 'string', { size: 32, required: true, default: 'ACTIVE' }],
    ['owner_member_id', 'string', { size: 36, required: true }],
    ['created_at', 'datetime', { required: true }],
    ['created_by', 'string', { size: 36, required: true }],
    ['updated_at', 'datetime', { required: true }],
    ['updated_by', 'string', { size: 36, required: true }],
    ['is_archived', 'boolean', { required: true, default: false }],
  ],
  contacts: [
    ['company_id', 'string', { size: 36, required: true }],
    ['full_name', 'string', { size: 160 }],
    ['first_name', 'string', { size: 80 }],
    ['last_name', 'string', { size: 80 }],
    ['designation', 'string', { size: 120 }],
    ['department', 'string', { size: 120 }],
    ['contact_context', 'string', { size: 3000 }],
    ['work_email', 'string', { size: 320 }],
    ['normalized_email', 'string', { size: 320 }],
    ['alternate_email', 'string', { size: 320 }],
    ['phone', 'string', { size: 40 }],
    ['linkedin_url', 'string', { size: 500 }],
    ['country', 'string', { size: 100 }],
    ['city', 'string', { size: 100 }],
    ['preferred_channel', 'string', { size: 32 }],
    ['is_primary_contact', 'boolean', { required: true, default: false }],
    ['contact_status', 'string', { size: 32, required: true, default: 'UNVERIFIED' }],
    ['source_urls', 'string', { size: 2000, array: true }],
    ['source_notes', 'string', { size: 3000 }],
    ['verification_date', 'datetime' ],
    ['verified_by', 'string', { size: 36 }],
    ['owner_member_id', 'string', { size: 36, required: true }],
    ['created_at', 'datetime', { required: true }],
    ['created_by', 'string', { size: 36, required: true }],
    ['updated_at', 'datetime', { required: true }],
    ['updated_by', 'string', { size: 36, required: true }],
  ],
  leads: [
    ['company_id', 'string', { size: 36, required: true }],
    ['lead_source', 'string', { size: 32, required: true }],
    ['source_details', 'string', { size: 2000 }],
    ['research_notes', 'string', { size: 5000 }],
    ['target_department', 'string', { size: 160 }],
    ['lead_status', 'string', { size: 32, required: true, default: 'NEW' }],
    ['priority', 'string', { size: 16, required: true, default: 'NORMAL' }],
    ['owner_member_id', 'string', { size: 36, required: true }],
    ['assigned_member_id', 'string', { size: 36 }],
    ['last_contacted_at', 'datetime'],
    ['next_followup_at', 'datetime'],
    ['created_at', 'datetime', { required: true }],
    ['created_by', 'string', { size: 36, required: true }],
    ['updated_at', 'datetime', { required: true }],
    ['updated_by', 'string', { size: 36, required: true }],
    ['is_archived', 'boolean', { required: true, default: false }],
  ],
  communications: [
    ['company_id', 'string', { size: 36, required: true }], ['contact_id', 'string', { size: 36 }], ['lead_id', 'string', { size: 36 }], ['opportunity_id', 'string', { size: 36 }],
    ['channel', 'string', { size: 32, required: true }], ['direction', 'string', { size: 16, required: true }], ['subject', 'string', { size: 300 }], ['message_summary', 'string', { size: 2000 }], ['message_body', 'string', { size: 10000 }],
    ['template_id', 'string', { size: 36 }], ['sender_account_label', 'string', { size: 40 }], ['recipient', 'string', { size: 320 }], ['occurred_at', 'datetime', { required: true }], ['sent_by_user_id', 'string', { size: 36, required: true }],
    ['result_status', 'string', { size: 32, required: true }], ['response_category', 'string', { size: 32 }], ['previous_communication_id', 'string', { size: 36 }], ['external_thread_reference', 'string', { size: 200 }], ['attachment_document_ids', 'string', { size: 2000, array: true }],
    ['owner_member_id', 'string', { size: 36, required: true }], ['created_at', 'datetime', { required: true }], ['created_by', 'string', { size: 36, required: true }], ['updated_at', 'datetime', { required: true }], ['updated_by', 'string', { size: 36, required: true }],
  ],
  followups: [
    ['company_id', 'string', { size: 36, required: true }], ['contact_id', 'string', { size: 36 }], ['lead_id', 'string', { size: 36 }], ['opportunity_id', 'string', { size: 36 }], ['related_communication_id', 'string', { size: 36 }],
    ['title', 'string', { size: 200, required: true }], ['notes', 'string', { size: 3000 }], ['assigned_to_user_id', 'string', { size: 36, required: true }], ['due_at', 'datetime', { required: true }],
    ['priority', 'string', { size: 16, required: true, default: 'NORMAL' }], ['status', 'string', { size: 20, required: true, default: 'PENDING' }], ['reminder_at', 'datetime'], ['completed_at', 'datetime'],
    ['owner_member_id', 'string', { size: 36, required: true }], ['created_at', 'datetime', { required: true }], ['created_by', 'string', { size: 36, required: true }], ['updated_at', 'datetime', { required: true }], ['updated_by', 'string', { size: 36, required: true }],
  ],
  opportunities: [
    ['company_id', 'string', { size: 36, required: true }], ['title', 'string', { size: 200, required: true }], ['opportunity_type', 'string', { size: 32, required: true }], ['role_title', 'string', { size: 200 }], ['job_description_text', 'string', { size: 10000 }],
    ['location', 'string', { size: 200 }], ['work_mode', 'string', { size: 24 }], ['openings_count', 'integer'], ['stipend_amount', 'float'], ['salary_min', 'float'], ['salary_max', 'float'], ['currency', 'string', { size: 8, required: true, default: 'INR' }], ['compensation_notes', 'string', { size: 1000 }], ['duration', 'string', { size: 120 }], ['start_date', 'datetime'],
    ['application_form_url', 'string', { size: 500 }], ['application_deadline', 'datetime'], ['details_json', 'string', { size: 2000 }], ['opportunity_status', 'string', { size: 32, required: true, default: 'DRAFT' }],
    ['owner_member_id', 'string', { size: 36, required: true }], ['created_at', 'datetime', { required: true }], ['created_by', 'string', { size: 36, required: true }], ['updated_at', 'datetime', { required: true }], ['updated_by', 'string', { size: 36, required: true }], ['is_archived', 'boolean', { required: true, default: false }],
  ],
  academic_confirmations: [
    ['opportunity_id', 'string', { size: 36, required: true }], ['company_id', 'string', { size: 36, required: true }], ['confirmation_type', 'string', { size: 40, required: true }], ['requested_from', 'string', { size: 20, required: true }], ['status', 'string', { size: 24, required: true }], ['academic_year', 'string', { size: 16 }], ['joining_date', 'datetime'], ['exam_period_start', 'datetime'], ['exam_period_end', 'datetime'], ['confirmation_text', 'string', { size: 5000 }], ['contact_id', 'string', { size: 36 }], ['communication_id', 'string', { size: 36 }], ['confirmed_at', 'datetime'], ['owner_member_id', 'string', { size: 36, required: true }], ['created_at', 'datetime', { required: true }], ['created_by', 'string', { size: 36, required: true }], ['updated_at', 'datetime', { required: true }], ['updated_by', 'string', { size: 36, required: true }],
  ],
  students: [
    ['full_name', 'string', { size: 160, required: true }], ['university_roll_number', 'string', { size: 64 }], ['university_email', 'string', { size: 320 }], ['personal_email', 'string', { size: 320 }], ['phone', 'string', { size: 40 }], ['college_name', 'string', { size: 200 }], ['campus_type', 'string', { size: 20 }], ['branch', 'string', { size: 120 }], ['program', 'string', { size: 120 }], ['semester', 'string', { size: 40 }], ['graduation_batch', 'string', { size: 32 }], ['cgpa_or_percentage', 'string', { size: 40 }], ['backlog_count', 'integer'], ['eligibility_notes', 'string', { size: 3000 }], ['owner_member_id', 'string', { size: 36, required: true }], ['created_at', 'datetime', { required: true }], ['created_by', 'string', { size: 36, required: true }], ['updated_at', 'datetime', { required: true }], ['updated_by', 'string', { size: 36, required: true }], ['is_archived', 'boolean', { required: true, default: false }],
  ],
  applications: [
    ['opportunity_id', 'string', { size: 36, required: true }], ['student_id', 'string', { size: 36, required: true }], ['applied_at', 'datetime'], ['application_source', 'string', { size: 16, required: true }], ['form_reference', 'string', { size: 200 }], ['application_status', 'string', { size: 24, required: true, default: 'APPLIED' }], ['notes', 'string', { size: 3000 }], ['owner_member_id', 'string', { size: 36, required: true }], ['created_at', 'datetime', { required: true }], ['created_by', 'string', { size: 36, required: true }], ['updated_at', 'datetime', { required: true }], ['updated_by', 'string', { size: 36, required: true }],
  ],
  resume_shares: [
    ['opportunity_id', 'string', { size: 36, required: true }], ['student_id', 'string', { size: 36, required: true }], ['shared_with_contact_id', 'string', { size: 36 }], ['communication_id', 'string', { size: 36 }], ['shared_at', 'datetime', { required: true }], ['shared_by', 'string', { size: 36, required: true }], ['channel', 'string', { size: 24, required: true }], ['batch_id', 'string', { size: 36 }], ['notes', 'string', { size: 2000 }], ['owner_member_id', 'string', { size: 36, required: true }], ['created_at', 'datetime', { required: true }],
  ],
  interviews: [
    ['application_id', 'string', { size: 36, required: true }], ['opportunity_id', 'string', { size: 36, required: true }], ['round_number', 'integer', { required: true }], ['round_name', 'string', { size: 40, required: true }], ['scheduled_at', 'datetime'], ['mode', 'string', { size: 16 }], ['venue_or_meeting_details', 'string', { size: 1000 }], ['interviewer_contact_id', 'string', { size: 36 }], ['attendance_status', 'string', { size: 20, required: true, default: 'SCHEDULED' }], ['result', 'string', { size: 24, required: true, default: 'PENDING' }], ['feedback', 'string', { size: 5000 }], ['result_received_at', 'datetime'], ['owner_member_id', 'string', { size: 36, required: true }], ['created_at', 'datetime', { required: true }], ['created_by', 'string', { size: 36, required: true }], ['updated_at', 'datetime', { required: true }], ['updated_by', 'string', { size: 36, required: true }],
  ],
  import_batches: [
    ['batch_name', 'string', { size: 200 }], ['source_type', 'string', { size: 24, required: true }], ['source_filename', 'string', { size: 255 }], ['started_at', 'datetime', { required: true }], ['completed_at', 'datetime'], ['status', 'string', { size: 24, required: true }], ['total_rows', 'integer', { required: true }], ['valid_rows', 'integer', { required: true }], ['warning_rows', 'integer', { required: true }], ['invalid_rows', 'integer', { required: true }], ['created_records', 'integer', { required: true }], ['skipped_records', 'integer', { required: true }], ['error_summary', 'string', { size: 2000 }], ['created_by', 'string', { size: 36, required: true }], ['created_at', 'datetime', { required: true }], ['updated_at', 'datetime', { required: true }],
  ],
  import_batch_rows: [
    ['batch_id', 'string', { size: 36, required: true }], ['row_number', 'integer', { required: true }], ['raw_row', 'string', { size: 4000, required: true }], ['mapped_row', 'string', { size: 4000 }], ['validation_status', 'string', { size: 32, required: true }], ['validation_errors', 'string', { size: 2000, array: true }], ['validation_warnings', 'string', { size: 2000, array: true }], ['duplicate_company_id', 'string', { size: 36 }], ['duplicate_contact_id', 'string', { size: 36 }], ['save_status', 'string', { size: 20, required: true }], ['created_company_id', 'string', { size: 36 }], ['created_contact_ids', 'string', { size: 2000, array: true }], ['created_lead_id', 'string', { size: 36 }], ['error_message', 'string', { size: 1000 }], ['created_at', 'datetime', { required: true }],
  ],
  bulk_update_operations: [
    ['table_id', 'string', { size: 40, required: true }], ['created_by', 'string', { size: 36, required: true }],
    ['status', 'string', { size: 24, required: true }], ['total_rows', 'integer', { required: true }],
    ['applied_rows', 'integer', { required: true }], ['created_at', 'datetime', { required: true }],
    ['updated_at', 'datetime', { required: true }],
  ],
  bulk_update_rows: [
    ['operation_id', 'string', { size: 36, required: true }], ['record_id', 'string', { size: 36, required: true }],
    ['changed_fields', 'string', { size: 2000, array: true }], ['old_values', 'string', { size: 20000, required: true }],
    ['new_values', 'string', { size: 20000 }], ['expected_updated_at', 'datetime'], ['status', 'string', { size: 24, required: true }],
    ['created_at', 'datetime', { required: true }],
  ],
  activity_logs: [
    ['actor_user_id', 'string', { size: 36, required: true }],
    ['actor_role', 'string', { size: 32, required: true }],
    ['action_type', 'string', { size: 32, required: true }],
    ['entity_type', 'string', { size: 64, required: true }],
    ['entity_id', 'string', { size: 36, required: true }],
    ['old_values', 'string', { size: 2000 }],
    ['new_values', 'string', { size: 2000 }],
    ['changed_fields', 'string', { size: 2000, array: true }],
    ['occurred_at', 'datetime', { required: true }],
    ['request_id', 'string', { size: 100 }],
    ['source', 'string', { size: 32, required: true }],
    ['import_batch_id', 'string', { size: 36 }],
  ],
  notification_reads: [
    ['user_id', 'string', { size: 36, required: true }],
    ['notification_id', 'string', { size: 100, required: true }],
    ['read_at', 'datetime', { required: true }],
    ['created_at', 'datetime', { required: true }],
  ],
  documents: [
    ['storage_file_id', 'string', { size: 36, required: true }],
    ['bucket_id', 'string', { size: 36, required: true }],
    ['file_name', 'string', { size: 255, required: true }],
    ['mime_type', 'string', { size: 100, required: true }],
    ['file_size', 'integer', { required: true }],
    ['related_entity_type', 'string', { size: 32, required: true }],
    ['related_entity_id', 'string', { size: 36, required: true }],
    ['owner_member_id', 'string', { size: 36, required: true }],
    ['created_by', 'string', { size: 36, required: true }],
    ['created_at', 'datetime', { required: true }],
    ['updated_at', 'datetime', { required: true }],
    ['is_archived', 'boolean', { required: true, default: false }],
  ],
  templates: [
    ['title', 'string', { size: 200, required: true }],
    ['category', 'string', { size: 80, required: true }],
    ['channel', 'string', { size: 32, required: true }],
    ['subject', 'string', { size: 300 }],
    ['body', 'string', { size: 10000, required: true }],
    ['variables', 'string', { size: 2000, array: true }],
    ['is_active', 'boolean', { required: true, default: true }],
    ['is_archived', 'boolean', { required: true, default: false }],
    ['created_at', 'datetime', { required: true }],
    ['created_by', 'string', { size: 36, required: true }],
    ['updated_at', 'datetime', { required: true }],
    ['updated_by', 'string', { size: 36, required: true }],
  ],
};

const client = new sdk.Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setKey(apiKey);
const tablesDb = new sdk.TablesDB(client);

async function ensureTable(tableId) {
  try {
    return await tablesDb.getTable(databaseId, tableId);
  } catch (error) {
    if (error.code !== 404) throw error;
    return tablesDb.createTable(databaseId, tableId, tableId, [], true, true);
  }
}

async function ensureColumn(tableId, [key, type, config = {}]) {
  try {
    const existing = await tablesDb.getColumn(databaseId, tableId, key);
    if (type === 'string' && config.size && existing.size > config.size) {
      return tablesDb.updateStringColumn(databaseId, tableId, key, Boolean(existing.required), existing.default ?? null, config.size);
    }
    return existing;
  } catch (error) {
    if (error.code !== 404) throw error;
    const required = Boolean(config.required);
    const defaultValue = required || config.default === undefined ? null : config.default;
    if (type === 'string') return tablesDb.createStringColumn(databaseId, tableId, key, config.size || 255, required, defaultValue, Boolean(config.array));
    if (type === 'boolean') return tablesDb.createBooleanColumn(databaseId, tableId, key, required, defaultValue);
    if (type === 'datetime') return tablesDb.createDatetimeColumn(databaseId, tableId, key, required, defaultValue);
    if (type === 'integer') return tablesDb.createIntegerColumn(databaseId, tableId, key, required, config.min ?? null, config.max ?? null, config.default ?? null, Boolean(config.array));
    if (type === 'float') return tablesDb.createFloatColumn(databaseId, tableId, key, required, config.min ?? null, config.max ?? null, config.default ?? null, Boolean(config.array));
    throw new Error(`Unsupported schema column type: ${type}`);
  }
}

async function main() {
  console.log(`Verifying Appwrite TablesDB database ${databaseId}...`);
  await tablesDb.listTables(databaseId);
  const requestedTables = (process.env.SETUP_TABLES || '').split(',').map((item) => item.trim()).filter(Boolean);
  const selectedTables = requestedTables.length ? Object.entries(tables).filter(([tableId]) => requestedTables.includes(tableId)) : Object.entries(tables);
  if (requestedTables.some((tableId) => !tables[tableId])) throw new Error(`Unknown table in SETUP_TABLES: ${requestedTables.find((tableId) => !tables[tableId])}`);
  for (const [tableId, columns] of selectedTables) {
    await ensureTable(tableId);
    for (const column of columns) await ensureColumn(tableId, column);
    console.log(`Ready: ${tableId} (${columns.length} columns)`);
  }
  console.log('Selected TablesDB schema is ready.');
}

main().catch((error) => {
  console.error(`Appwrite setup failed: ${error.message}`);
  process.exitCode = 1;
});
