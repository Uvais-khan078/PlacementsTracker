'use strict';

const express = require('express');
const crypto = require('crypto');
const { InputFile } = require('node-appwrite/file');
const { AppError, adminTables, adminUsers, adminStorage, authenticateRequest, databaseId, recruitmentBucketId, sdk } = require('./appwrite');

const router = express.Router();
let legacySourceFilesCache = { expiresAt: 0, files: [], total: 0 };
const completeReadCache = new Map();
const COMPLETE_READ_CACHE_TTL_MS = 5000;
const MAX_LIMIT = 50;
const ROLES = ['SUPER_ADMIN', 'COMMITTEE_MEMBER'];
const LEAD_SOURCES = ['RESEARCH', 'REFERRAL', 'LINKEDIN', 'WEBSITE', 'EVENT', 'EXISTING_CONTACT', 'OTHER'];
const LEAD_STATUSES = ['NEW', 'RESEARCHING', 'READY_TO_CONTACT', 'OUTREACH_STARTED', 'AWAITING_RESPONSE', 'FOLLOW_UP_DUE', 'INTERESTED', 'NOT_INTERESTED', 'INVALID_CONTACT', 'ON_HOLD', 'ARCHIVED'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const COMPANY_CATEGORIES = ['GOVERNMENT', 'PRIVATE', 'OTHER'];
const COMPANY_STATUSES = ['ACTIVE', 'INACTIVE', 'DO_NOT_CONTACT', 'ARCHIVED'];
const COMMUNICATION_CHANNELS = ['EMAIL', 'LINKEDIN_CONNECTION', 'LINKEDIN_MESSAGE', 'LINKEDIN_POST_COMMENT', 'PHONE', 'OTHER'];
const COMMUNICATION_RESULTS = ['DRAFTED', 'SENT', 'DELIVERED', 'REPLY_RECEIVED', 'BOUNCED_INVALID', 'NO_REPLY', 'FOLLOW_UP_SENT', 'OTHER'];
const RESPONSE_CATEGORIES = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'REFERRAL', 'NO_OPENINGS', 'NEEDS_INFORMATION', 'NOT_APPLICABLE'];
const FOLLOWUP_STATUSES = ['PENDING', 'COMPLETED', 'RESCHEDULED', 'CANCELLED'];
const OPPORTUNITY_TYPES = ['INTERNSHIP', 'FULL_TIME', 'PLACEMENT', 'PPO', 'TRAINING', 'OTHER'];
const OPPORTUNITY_STATUSES = ['DRAFT', 'JD_AWAITED', 'JD_RECEIVED', 'CONFIRMATION_PENDING', 'CONFIRMED', 'FORM_FLOATED', 'APPLICATIONS_CLOSED', 'RESUMES_SHARED', 'INTERVIEWS', 'RESULTS_AWAITED', 'COMPLETED', 'CANCELLED'];
const PERMISSION_MODULES = ['Dashboard', 'Companies', 'Contacts', 'Leads', 'Communications', 'Follow-ups', 'Opportunities', 'Academic confirmations', 'Students', 'Applications', 'Interviews', 'Meeting notes', 'Templates', 'Reports'];
const DEFAULT_PERMISSIONS = Object.fromEntries(PERMISSION_MODULES.map((module) => [module, 'WRITE']));
const BULK_UPDATE_FIELDS = {
  companies: ['company_name', 'website', 'careers_url', 'linkedin_url', 'industry', 'sector', 'organization_type', 'organization_category', 'city', 'state', 'country', 'full_address', 'general_email', 'general_phone', 'company_description', 'source_notes', 'company_status'],
  contacts: ['full_name', 'first_name', 'last_name', 'designation', 'department', 'contact_context', 'work_email', 'alternate_email', 'phone', 'linkedin_url', 'country', 'city', 'preferred_channel', 'is_primary_contact', 'contact_status', 'source_notes'],
  leads: ['lead_source', 'lead_status', 'priority', 'source_details', 'research_notes', 'target_department', 'last_contacted_at', 'next_followup_at'],
  communications: ['channel', 'direction', 'subject', 'message_summary', 'message_body', 'sender_account_label', 'recipient', 'occurred_at', 'result_status', 'response_category', 'external_thread_reference'],
  followups: ['title', 'due_at', 'reminder_at', 'priority', 'status', 'notes'],
  opportunities: ['title', 'opportunity_type', 'role_title', 'job_description_text', 'location', 'work_mode', 'openings_count', 'stipend_amount', 'salary_min', 'salary_max', 'currency', 'compensation_notes', 'duration', 'start_date', 'application_form_url', 'application_deadline', 'opportunity_status'],
  academic_confirmations: ['confirmation_type', 'requested_from', 'status', 'academic_year', 'joining_date', 'exam_period_start', 'exam_period_end', 'confirmation_text'],
  students: ['full_name', 'university_roll_number', 'university_email', 'personal_email', 'phone', 'college_name', 'campus_type', 'branch', 'program', 'semester', 'graduation_batch', 'cgpa_or_percentage', 'backlog_count', 'eligibility_notes'],
  applications: ['application_status', 'application_source', 'form_reference', 'applied_at', 'notes'],
  interviews: ['round_number', 'round_name', 'scheduled_at', 'mode', 'venue_or_meeting_details', 'interviewer_contact_id', 'attendance_status', 'result', 'feedback', 'result_received_at'],
  templates: ['title', 'category', 'channel', 'subject', 'body'],
};
const TABLE_MODULE = { companies: 'Companies', contacts: 'Contacts', leads: 'Leads', communications: 'Communications', followups: 'Follow-ups', opportunities: 'Opportunities', academic_confirmations: 'Academic confirmations', students: 'Students', applications: 'Applications', interviews: 'Interviews', templates: 'Templates' };
const ROUTE_TABLE = { companies: 'companies', contacts: 'contacts', leads: 'leads', communications: 'communications', followups: 'followups', opportunities: 'opportunities', 'academic-confirmations': 'academic_confirmations', students: 'students', applications: 'applications', interviews: 'interviews', templates: 'templates' };
const IMPORT_HEADER_ALIASES = {
  company_name: ['Organisation Name', 'Organization Name', 'Company Name', 'Name of Company', 'Company'],
  contact_name: ['Name of the HR', 'HR Name', 'HR Name/Head', 'Public HR / Recruiter Name'],
  work_email: ['Email', 'HR Email ID', 'Email ID', 'Public HR / Recruitment Email', 'Active Email'],
  phone: ['Contact (Mobile)', 'Contact Number', 'HR Contact Number', 'Phone'],
  location: ['Location', 'Company Location', 'Location / City'],
  branches: ['Target Branches', 'Eligible Branches'],
  assigned_label: ['Assigned To', 'Assigned To (Member)', 'Follow-up Owner', 'Lead Generated By', 'Contacted By'],
  industry: ['Industry', 'Industry / Sector'],
  website: ['Company Website', 'Website'],
  lead_notes: ['Remarks', 'Notes', 'Research Notes', 'Hiring Notes'],
};

function now() { return new Date().toISOString(); }
function requestId(request) { return request.get('x-request-id') || sdk.ID.unique(); }
function text(value, field, max = 5000) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.trim().length > max) throw new AppError('VALIDATION_ERROR', `${field} must be a string of ${max} characters or fewer.`, 400, { [field]: 'Invalid text value.' });
  return value.trim();
}
function enumValue(value, field, allowed, fallback) {
  const candidate = value === undefined || value === '' ? fallback : value;
  if (!allowed.includes(candidate)) throw new AppError('VALIDATION_ERROR', `${field} has an invalid value.`, 400, { [field]: `Use one of: ${allowed.join(', ')}.` });
  return candidate;
}
function email(value, field) {
  const candidate = text(value, field, 320).toLowerCase();
  if (candidate && !/^\S+@\S+\.\S+$/.test(candidate)) throw new AppError('VALIDATION_ERROR', `${field} must be a valid email address.`, 400, { [field]: 'Invalid email address.' });
  return candidate;
}
function url(value, field) {
  const candidate = text(value, field, 500);
  if (!candidate) return '';
  try { new URL(candidate); } catch { throw new AppError('VALIDATION_ERROR', `${field} must be a valid URL.`, 400, { [field]: 'Invalid URL.' }); }
  return candidate;
}
function stringArray(value, field, max = 2000) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw new AppError('VALIDATION_ERROR', `${field} must be an array of strings.`, 400);
  const result = value.map((item) => text(item, field, 200)).filter(Boolean);
  if (JSON.stringify(result).length > max) throw new AppError('VALIDATION_ERROR', `${field} is too large.`, 400);
  return result;
}
function normalizedName(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function headerKey(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function memberPermissions(member) {
  if (member.role === 'SUPER_ADMIN') return { ...DEFAULT_PERMISSIONS };
  if (!member.permissions_json) return { ...DEFAULT_PERMISSIONS };
  try { const saved = JSON.parse(member.permissions_json); return Object.fromEntries(PERMISSION_MODULES.map((module) => [module, ['NONE', 'READ', 'WRITE'].includes(saved?.[module]) ? saved[module] : 'NONE'])); }
  catch { return Object.fromEntries(PERMISSION_MODULES.map((module) => [module, 'NONE'])); }
}
function safeMemberView(member) { return { id: member.$id, userId: member.user_id, loginId: member.login_id ? member.login_id.toUpperCase() : '', fullName: member.full_name, email: member.email, role: member.role, isActive: member.is_active, permissions: memberPermissions(member) }; }
function safeBusinessView(row, member) {
  const data = { id: row.$id, ...row };
  delete data.$id; delete data.$createdAt; delete data.$updatedAt; delete data.$permissions; delete data.$databaseId; delete data.$tableId;
  if (member.role !== 'SUPER_ADMIN') {
    delete data.created_by; delete data.updated_by; delete data.owner_member_id; delete data.assigned_member_id; delete data.assigned_to_user_id; delete data.verified_by; delete data.shared_by; delete data.sent_by_user_id; delete data.uploaded_by;
    data.is_mine = row.owner_member_id === member.user_id;
  }
  return data;
}
async function getRow(tableId, rowId) {
  try { return await adminTables.getRow(databaseId, tableId, rowId); } catch (error) {
    if (error.code === 404) throw new AppError('NOT_FOUND', `${tableId} record was not found.`, 404);
    throw error;
  }
}
async function listRows(tableId, queries = []) {
  return adminTables.listRows({ databaseId, tableId, queries: [...queries, sdk.Query.limit(MAX_LIMIT), sdk.Query.orderDesc('$createdAt')] });
}
function pageOptions(request) {
  const page = Math.max(1, Math.min(10000, Number.parseInt(request.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.parseInt(request.query.limit, 10) || MAX_LIMIT));
  return { page, limit, offset: (page - 1) * limit };
}
async function listRowsPage(tableId, queries, request) {
  const { page, limit, offset } = pageOptions(request);
  const result = await adminTables.listRows({ databaseId, tableId, queries: [...queries, sdk.Query.limit(limit), sdk.Query.offset(offset), sdk.Query.orderDesc('$createdAt')] });
  return { rows: result.rows, total: result.total, page, limit, pages: Math.max(1, Math.ceil(result.total / limit)) };
}
async function listRowsComplete(tableId, queries = [], maxRows = 10000) {
  const cacheKey = `${tableId}:${maxRows}:${JSON.stringify(queries)}`;
  const cached = completeReadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.promise) return cached.promise;
    return { rows: cached.rows };
  }
  completeReadCache.delete(cacheKey);
  const pending = (async () => {
    const rows = [];
    const pageSize = Math.min(1000, maxRows);
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const result = await adminTables.listRows({ databaseId, tableId, queries: [...queries, sdk.Query.limit(Math.min(pageSize, maxRows - offset)), sdk.Query.offset(offset), sdk.Query.orderDesc('$createdAt')] });
      rows.push(...result.rows);
      if (result.rows.length < pageSize || rows.length >= maxRows) break;
    }
    return { rows };
  })();
  completeReadCache.set(cacheKey, { expiresAt: Date.now() + COMPLETE_READ_CACHE_TTL_MS, promise: pending });
  try {
    const result = await pending;
    if (completeReadCache.get(cacheKey)?.promise === pending) {
      if (completeReadCache.size > 100) completeReadCache.delete(completeReadCache.keys().next().value);
      completeReadCache.set(cacheKey, { expiresAt: Date.now() + COMPLETE_READ_CACHE_TTL_MS, rows: result.rows });
    }
    return result;
  } catch (error) {
    if (completeReadCache.get(cacheKey)?.promise === pending) completeReadCache.delete(cacheKey);
    throw error;
  }
}
async function validateBulkUpdateRequest(request, member) {
  const operationId = text(request.get('x-bulk-operation-id'), 'bulk_operation_id', 36);
  const pathParts = request.path.split('/'); const tableId = ROUTE_TABLE[pathParts[1]]; const recordId = text(pathParts[2], 'record_id', 36);
  if (request.method !== 'PATCH' || !tableId || !/^[A-Za-z0-9_-]{1,36}$/.test(operationId) || !recordId) throw new AppError('VALIDATION_ERROR', 'Bulk update token is only valid for a prepared record update.', 400);
  const operation = await getRow('bulk_update_operations', operationId);
  if (operation.created_by !== member.user_id || operation.table_id !== tableId || operation.status !== 'PREPARED') throw new AppError('FORBIDDEN', 'This bulk update operation is invalid or no longer active.', 403);
  const rows = await listRows('bulk_update_rows', [sdk.Query.equal('operation_id', [operationId]), sdk.Query.equal('record_id', [recordId])]);
  const journal = rows.rows[0];
  if (!journal || journal.status !== 'PREPARED') throw new AppError('CONFLICT', 'This record was not prepared for the active bulk update.', 409);
  const fields = journal.changed_fields || [];
  if (!Object.keys(request.body || {}).length || Object.keys(request.body).some((field) => !fields.includes(field))) throw new AppError('VALIDATION_ERROR', 'The update fields do not match the prepared bulk operation.', 400);
}
async function captureBulkUpdate(member, tableId, recordId, request) {
  const operationId = text(request.get('x-bulk-operation-id'), 'bulk_operation_id', 36);
  if (!operationId) return;
  const operation = await getRow('bulk_update_operations', operationId);
  if (operation.created_by !== member.user_id || operation.table_id !== tableId) throw new AppError('FORBIDDEN', 'Bulk update operation ownership did not match.', 403);
  const matches = await listRows('bulk_update_rows', [sdk.Query.equal('operation_id', [operationId]), sdk.Query.equal('record_id', [recordId])]);
  const journal = matches.rows[0];
  if (!journal || journal.status !== 'PREPARED') throw new AppError('CONFLICT', 'Bulk update journal row is not ready.', 409);
  const row = await getRow(tableId, recordId); const fields = journal.changed_fields || [];
  const newValues = Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
  if (JSON.stringify(newValues).length > 20000) throw new AppError('PAYLOAD_TOO_LARGE', 'Bulk update snapshot exceeded its safe storage limit.', 413);
  await adminTables.updateRow(databaseId, 'bulk_update_rows', journal.$id, { ...journal, new_values: JSON.stringify(newValues), expected_updated_at: row.updated_at, status: 'APPLIED' });
  const all = await listRowsComplete('bulk_update_rows', [sdk.Query.equal('operation_id', [operationId])], 250);
  const appliedRows = all.rows.filter((item) => item.status === 'APPLIED').length;
  await adminTables.updateRow(databaseId, 'bulk_update_operations', operation.$id, { ...operation, applied_rows: appliedRows, updated_at: now() });
}
async function audit(member, actionType, entityType, entityId, oldValues, newValues, req) {
  await adminTables.createRow(databaseId, 'activity_logs', sdk.ID.unique(), {
    actor_user_id: member.user_id,
    actor_role: member.role,
    action_type: actionType,
    entity_type: entityType,
    entity_id: entityId,
    old_values: oldValues ? JSON.stringify(oldValues).slice(0, 2000) : '',
    new_values: newValues ? JSON.stringify(newValues).slice(0, 2000) : '',
    changed_fields: newValues ? Object.keys(newValues) : [],
    occurred_at: now(),
    request_id: requestId(req),
    source: 'UI',
  });
  completeReadCache.clear();
  const tableId = Object.keys(ROUTE_TABLE).map((route) => ROUTE_TABLE[route]).find((table) => table === entityType);
  if (tableId && req.get('x-bulk-operation-id')) await captureBulkUpdate(member, tableId, entityId, req);
}
async function resolveOwner(member, requestedOwner) {
  if (member.role !== 'SUPER_ADMIN') return member.user_id;
  if (!requestedOwner) return member.user_id;
  const result = await listRows('members', [sdk.Query.equal('user_id', [requestedOwner]), sdk.Query.equal('is_active', [true])]);
  if (!result.rows[0]) throw new AppError('VALIDATION_ERROR', 'Assign To must be an active committee member.', 400, { assign_to_member_id: 'Unknown or inactive member.' });
  return requestedOwner;
}
async function requireCompany(companyId) { return getRow('companies', companyId); }
function safeOpportunityView(row, member) { const details = row.details_json ? JSON.parse(row.details_json) : {}; const view = safeBusinessView(row, member); delete view.details_json; return { ...view, ...details }; }
function numberValue(value, field, { integer = false, min = 0 } = {}) { if (value === undefined || value === null || value === '') return null; const number = Number(value); if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < min) throw new AppError('VALIDATION_ERROR', `${field} must be a valid ${integer ? 'whole' : 'non-negative'} number.`, 400); return number; }
async function optionalRelated(tableId, id, companyId) { if (!id) return ''; const row = await getRow(tableId, id); const relatedCompany = row.company_id || (tableId === 'communications' ? (await getRow('opportunities', row.opportunity_id)).company_id : ''); if (companyId && relatedCompany !== companyId) throw new AppError('VALIDATION_ERROR', `${tableId} record must belong to the selected company.`, 400); return id; }
function dateValue(value, field, required = false) { if (!value && !required) return ''; const date = new Date(value); if (!value || Number.isNaN(date.getTime())) throw new AppError('VALIDATION_ERROR', `${field} must be a valid date and time.`, 400); return date.toISOString(); }

router.post('/auth/login-target', async (request, response, next) => {
  try {
    const loginId = text(request.body?.login_id, 'login_id', 40).toLowerCase();
    if (!loginId) throw new AppError('VALIDATION_ERROR', 'Login ID is required.', 400);
    const result = await listRows('members', [sdk.Query.equal('login_id', [loginId]), sdk.Query.limit(1)]);
    const member = result.rows[0];
    if (!member || !member.is_active) throw new AppError('UNAUTHENTICATED', 'Invalid Login ID or password.', 401);
    response.json({ ok: true, data: { email: member.email }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.use(async (request, _response, next) => {
  try {
    request.auth = await authenticateRequest(request);
    const { member } = request.auth;
    if (request.get('x-bulk-operation-id')) await validateBulkUpdateRequest(request, member);
    if (member.role === 'SUPER_ADMIN') return next();
    const path = request.path;
    let modules = [];
    const prefixes = {
      '/companies': 'Companies', '/contacts': 'Contacts', '/leads': 'Leads', '/communications': 'Communications', '/followups': 'Follow-ups',
      '/opportunities': 'Opportunities', '/academic-confirmations': 'Academic confirmations', '/students': 'Students', '/applications': 'Applications',
      '/interviews': 'Interviews', '/resume-shares': 'Students', '/templates': 'Templates', '/meeting-notes': 'Meeting notes', '/reports': 'Reports',
    };
    const matched = Object.entries(prefixes).find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
    if (matched) modules = [matched[1]];
    else if (path === '/dashboard') modules = ['Dashboard'];
    else if (path === '/search') modules = ['Companies', 'Contacts', 'Leads', 'Opportunities', 'Students', 'Applications'];
    else if (path === '/notifications') modules = ['Follow-ups', 'Academic confirmations', 'Interviews'];
    else if (path.startsWith('/imports')) modules = ['Companies', 'Contacts', 'Leads'];
    else if (path === '/bulk/undo') {
      modules = [...new Set((Array.isArray(request.body?.records) ? request.body.records : []).map((record) => TABLE_MODULE[record?.table]).filter(Boolean))];
    } else if (path === '/bulk/updates/prepare') {
      modules = [TABLE_MODULE[request.body?.table_id]].filter(Boolean);
    } else if (path.startsWith('/bulk/updates/')) {
      const operation = await getRow('bulk_update_operations', path.split('/')[3]);
      modules = [TABLE_MODULE[operation.table_id]].filter(Boolean);
    }
    else if (path.startsWith('/documents')) {
      const entityType = request.query.entity_type || request.body?.entity_type || request.get('x-related-entity-type');
      const entityModule = { COMPANY: 'Companies', OPPORTUNITY: 'Opportunities', APPLICATION: 'Applications', ACADEMIC_CONFIRMATION: 'Academic confirmations' }[entityType];
      if (entityModule) modules = [entityModule];
      else { const documentId = path.split('/')[2]; if (documentId && documentId !== 'upload') { const document = await getRow('documents', documentId); const related = { COMPANY: 'Companies', OPPORTUNITY: 'Opportunities', APPLICATION: 'Applications', ACADEMIC_CONFIRMATION: 'Academic confirmations' }[document.related_entity_type]; if (related) modules = [related]; } }
    }
    if (modules.length) {
      const required = ['GET', 'HEAD'].includes(request.method) ? 'READ' : 'WRITE';
      const granted = memberPermissions(member);
      const denied = modules.filter((module) => { const actual = granted[module]; return actual === 'NONE' || (required === 'WRITE' && actual !== 'WRITE'); });
      if (denied.length) throw new AppError('FORBIDDEN', `Your account does not have ${required.toLowerCase()} access to: ${denied.join(', ')}.`, 403);
    }
    next();
  } catch (error) { next(error); }
});

router.get('/auth/profile', (request, response) => response.json({ ok: true, data: safeMemberView(request.auth.member), meta: { requestId: requestId(request) } }));

async function getDocumentEntity(entityType, entityId) {
  const table = { COMPANY: 'companies', OPPORTUNITY: 'opportunities', APPLICATION: 'applications', ACADEMIC_CONFIRMATION: 'academic_confirmations' }[entityType];
  if (!table) throw new AppError('VALIDATION_ERROR', 'Unsupported document relationship.', 400);
  const entity = await getRow(table, entityId);

  return entity;
}

async function validateDocumentReference(documentId, entityType, entityId, purpose = 'document') {
  if (!documentId) return '';
  const document = await getRow('documents', documentId);
  if (document.is_archived || document.related_entity_type !== entityType || document.related_entity_id !== entityId) throw new AppError('VALIDATION_ERROR', `Select an active ${purpose} attached to this record.`, 400);
  return document.$id;
}

async function validateCommunicationAttachments(ids, companyId) {
  const uniqueIds = [...new Set(stringArray(ids, 'attachment_document_ids', 4000))];
  for (const id of uniqueIds) {
    const document = await getRow('documents', id);
    if (document.is_archived) throw new AppError('VALIDATION_ERROR', 'Communication evidence must reference active documents.', 400);
    const entity = await getDocumentEntity(document.related_entity_type, document.related_entity_id);
    const opportunity = document.related_entity_type === 'OPPORTUNITY' ? entity : (entity.opportunity_id ? await getRow('opportunities', entity.opportunity_id) : null);
    if (document.related_entity_type === 'COMPANY' && entity.$id !== companyId) throw new AppError('VALIDATION_ERROR', 'Communication evidence must belong to the selected company.', 400);
    if (opportunity && opportunity.company_id !== companyId) throw new AppError('VALIDATION_ERROR', 'Communication evidence must belong to the selected company.', 400);
    if (!['COMPANY', 'OPPORTUNITY', 'APPLICATION', 'ACADEMIC_CONFIRMATION'].includes(document.related_entity_type)) throw new AppError('VALIDATION_ERROR', 'Only company and recruitment evidence can be attached to communications.', 400);
  }
  return uniqueIds;
}

function bucketIdForEntity() { return recruitmentBucketId; }

async function ensurePrivateStorage(bucketId) {
  let bucket;
  try { bucket = await adminStorage.getBucket({ bucketId }); } catch (error) {
    if (error.code === 401 || error.code === 403) throw new AppError('STORAGE_UNAVAILABLE', 'Storage access is not enabled for the backend API key. Grant buckets.read, buckets.write, files.read, files.write and files.delete scopes.', 503);
    if (error.code === 404) throw new AppError('STORAGE_UNAVAILABLE', 'The configured private Storage bucket has not been created.', 503);
    throw error;
  }
  const permissions = bucket.$permissions || bucket.permissions || [];
  if (!bucket.enabled || !bucket.fileSecurity || permissions.length !== 0 || !bucket.encryption) throw new AppError('STORAGE_UNAVAILABLE', 'The configured bucket must be enabled, encrypted, private and use file-level security.', 503);
  return bucket;
}

router.get('/storage/status', async (request, response, next) => {
  try {
    const buckets = [await ensurePrivateStorage(recruitmentBucketId)];
    response.json({ ok: true, data: { ready: true, buckets: buckets.map((bucket) => ({ bucket_id: bucket.$id, max_file_size: bucket.maximumFileSize, allowed_extensions: bucket.allowedFileExtensions })) }, meta: { requestId: requestId(request) } });
  } catch (error) {
    if (error.code === 'STORAGE_UNAVAILABLE') return response.json({ ok: true, data: { ready: false, message: error.message }, meta: { requestId: requestId(request) } });
    next(error);
  }
});

router.get('/documents', async (request, response, next) => {
  try {
    const member = request.auth.member; const entityType = enumValue(request.query.entity_type, 'entity_type', ['COMPANY', 'OPPORTUNITY', 'APPLICATION', 'ACADEMIC_CONFIRMATION']); const entityId = text(request.query.entity_id, 'entity_id', 36);
    if (!entityId) throw new AppError('VALIDATION_ERROR', 'entity_id is required.', 400);
    await getDocumentEntity(entityType, entityId);
    const result = await listRows('documents', [sdk.Query.equal('related_entity_type', [entityType]), sdk.Query.equal('related_entity_id', [entityId]), sdk.Query.equal('is_archived', [false])]);
    response.json({ ok: true, data: result.rows.map((row) => ({ id: row.$id, file_name: row.file_name, mime_type: row.mime_type, file_size: row.file_size, created_at: row.created_at, owner_member_id: member.role === 'SUPER_ADMIN' ? row.owner_member_id : undefined })), meta: { requestId: requestId(request), total: result.total } });
  } catch (error) { next(error); }
});

router.post('/documents/upload', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (request, response, next) => {
  try {
    const member = request.auth.member; const entityType = enumValue(request.get('x-related-entity-type'), 'entity_type', ['COMPANY', 'OPPORTUNITY', 'APPLICATION', 'ACADEMIC_CONFIRMATION']); const entityId = text(request.get('x-related-entity-id'), 'entity_id', 36);
    const rawName = text(request.get('x-file-name'), 'file_name', 255);
    let fileName; try { fileName = decodeURIComponent(rawName).split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '').trim(); } catch { throw new AppError('VALIDATION_ERROR', 'file_name must be URL encoded.', 400); }
    if (!fileName || !Buffer.isBuffer(request.body) || request.body.length === 0) throw new AppError('VALIDATION_ERROR', 'Choose a non-empty file to upload.', 400);
    if (request.body.length > 20 * 1024 * 1024) throw new AppError('PAYLOAD_TOO_LARGE', 'Documents must be 20 MB or smaller.', 413);
    const extension = fileName.toLowerCase().split('.').pop(); const allowed = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
    if (!allowed[extension]) throw new AppError('VALIDATION_ERROR', 'Accepted files: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG and JPEG.', 400);
    await getDocumentEntity(entityType, entityId); const bucket = await ensurePrivateStorage(bucketIdForEntity(entityType)); if (request.body.length > bucket.maximumFileSize) throw new AppError('PAYLOAD_TOO_LARGE', `Documents must be ${Math.floor(bucket.maximumFileSize / (1024 * 1024))} MB or smaller.`, 413);
    const fileId = sdk.ID.unique(); const timestamp = now();
    const stored = await adminStorage.createFile({ bucketId: bucket.$id, fileId, file: InputFile.fromBuffer(request.body, fileName), permissions: [] });
    const data = { storage_file_id: stored.$id, bucket_id: bucket.$id, file_name: fileName, mime_type: allowed[extension], file_size: request.body.length, related_entity_type: entityType, related_entity_id: entityId, owner_member_id: member.user_id, created_by: member.user_id, created_at: timestamp, updated_at: timestamp, is_archived: false };
    let metadataRowId;
    try {
      const row = await adminTables.createRow(databaseId, 'documents', sdk.ID.unique(), data); metadataRowId = row.$id;
      await audit(member, 'CREATE', 'documents', row.$id, null, { ...data, file_name: fileName }, request);
      response.status(201).json({ ok: true, data: { id: row.$id, file_name: row.file_name, mime_type: row.mime_type, file_size: row.file_size, created_at: row.created_at }, meta: { requestId: requestId(request) } });
    } catch (error) {
      if (metadataRowId) await adminTables.deleteRow(databaseId, 'documents', metadataRowId).catch(() => undefined);
      await adminStorage.deleteFile({ bucketId: bucket.$id, fileId: stored.$id }).catch(() => undefined);
      throw error;
    }
  } catch (error) { next(error); }
});

router.delete('/documents/:documentId', async (request, response, next) => {
  try {
    const { member } = request.auth; if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can remove recruitment evidence files.', 403);
    const row = await getRow('documents', request.params.documentId); if (row.is_archived) throw new AppError('NOT_FOUND', 'Document not found.', 404);
    const bucketId = bucketIdForEntity(row.related_entity_type); if (row.bucket_id !== bucketId) throw new AppError('STORAGE_UNAVAILABLE', 'Document metadata points to an unexpected private Storage bucket.', 503); await ensurePrivateStorage(bucketId);
    await adminStorage.deleteFile({ bucketId, fileId: row.storage_file_id });
    const updated = await adminTables.updateRow(databaseId, 'documents', row.$id, { ...row, is_archived: true, updated_at: now() });
    await audit(member, 'ARCHIVE', 'documents', row.$id, { file_name: row.file_name }, { is_archived: true }, request);
    response.json({ ok: true, data: { id: updated.$id, is_archived: true }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/documents/:documentId/download', async (request, response, next) => {
  try {
    const member = request.auth.member; const row = await getRow('documents', request.params.documentId);
    if (row.is_archived) throw new AppError('NOT_FOUND', 'Document not found.', 404);
    await getDocumentEntity(row.related_entity_type, row.related_entity_id); const expectedBucketId = bucketIdForEntity(row.related_entity_type); if (row.bucket_id !== expectedBucketId) throw new AppError('STORAGE_UNAVAILABLE', 'Document metadata points to an unexpected private Storage bucket.', 503); await ensurePrivateStorage(expectedBucketId);
    const content = await adminStorage.getFileDownload({ bucketId: row.bucket_id, fileId: row.storage_file_id });
    response.type(row.mime_type).attachment(row.file_name).send(Buffer.from(content));
  } catch (error) { next(error); }
});

router.get('/search', async (request, response, next) => {
  try {
    const term = text(request.query.q, 'q', 80).toLowerCase();
    if (term.length < 2) return response.json({ ok: true, data: [], meta: { requestId: requestId(request), scannedPerType: 0 } });
    const member = request.auth.member; const scope = request.query.scope === 'mine' ? [sdk.Query.equal('owner_member_id', [member.user_id])] : [];
    const [companies, contacts, students, opportunities, leads, applications] = await Promise.all([
      listRowsComplete('companies', [...scope, sdk.Query.select(['$id', 'company_name', 'industry', 'city', 'state'])]),
      listRowsComplete('contacts', [...scope, sdk.Query.select(['$id', 'full_name', 'designation', 'department', 'work_email', 'phone', 'company_id'])]),
      listRowsComplete('students', [...scope, sdk.Query.select(['$id', 'full_name', 'university_roll_number', 'university_email', 'college_name', 'branch'])]),
      listRowsComplete('opportunities', [...scope, sdk.Query.select(['$id', 'title', 'role_title', 'location', 'company_id', 'opportunity_type'])]),
      listRowsComplete('leads', [...scope, sdk.Query.select(['$id', 'company_id', 'lead_source', 'lead_status', 'target_department', 'research_notes', 'priority'])]),
      listRowsComplete('applications', [...scope, sdk.Query.select(['$id', 'student_id', 'opportunity_id', 'application_status', 'form_reference'])]),
    ]);
    const companyMap = new Map(companies.rows.map((row) => [row.$id, row.company_name]));
    const studentMap = new Map(students.rows.map((row) => [row.$id, row.full_name]));
    const opportunityMap = new Map(opportunities.rows.map((row) => [row.$id, row.title]));
    const matches = [];
    for (const row of companies.rows) if (`${row.company_name} ${row.industry} ${row.city} ${row.state}`.toLowerCase().includes(term)) matches.push({ id: row.$id, type: 'COMPANY', title: row.company_name, subtitle: [row.industry, row.city, row.state].filter(Boolean).join(' · '), page: 'Companies' });
    for (const row of contacts.rows) if (`${row.full_name} ${row.designation} ${row.department} ${row.work_email} ${row.phone}`.toLowerCase().includes(term)) matches.push({ id: row.$id, type: 'CONTACT', title: row.full_name, subtitle: `${companyMap.get(row.company_id) || 'Company'} · ${row.designation || row.work_email || row.phone || 'Contact'}`, page: 'Contacts' });
    for (const row of students.rows) if (`${row.full_name} ${row.university_roll_number} ${row.university_email} ${row.college_name} ${row.branch}`.toLowerCase().includes(term)) matches.push({ id: row.$id, type: 'STUDENT', title: row.full_name, subtitle: [row.university_roll_number, row.college_name, row.branch].filter(Boolean).join(' · '), page: 'Students' });
    for (const row of opportunities.rows) if (`${row.title} ${row.role_title} ${row.location}`.toLowerCase().includes(term)) matches.push({ id: row.$id, type: 'OPPORTUNITY', title: row.title, subtitle: `${companyMap.get(row.company_id) || 'Company'} · ${row.role_title || row.opportunity_type}`, page: 'Opportunities' });
    for (const row of leads.rows) if (`${companyMap.get(row.company_id) || ''} ${row.lead_source} ${row.lead_status} ${row.target_department} ${row.research_notes}`.toLowerCase().includes(term)) matches.push({ id: row.$id, type: 'LEAD', title: companyMap.get(row.company_id) || 'Company lead', subtitle: `${row.lead_status} · ${row.lead_source} · ${row.priority}`, page: 'Leads' });
    for (const row of applications.rows) if (`${studentMap.get(row.student_id) || ''} ${opportunityMap.get(row.opportunity_id) || ''} ${row.application_status} ${row.form_reference}`.toLowerCase().includes(term)) matches.push({ id: row.$id, type: 'APPLICATION', title: studentMap.get(row.student_id) || 'Student application', subtitle: `${opportunityMap.get(row.opportunity_id) || 'Opportunity'} · ${row.application_status}`, page: 'Applications' });
    matches.sort((a, b) => Number(!a.title.toLowerCase().startsWith(term)) - Number(!b.title.toLowerCase().startsWith(term)) || a.title.localeCompare(b.title));
    response.json({ ok: true, data: matches.slice(0, 40), meta: { requestId: requestId(request), total: matches.length, capped: [companies, contacts, students, opportunities, leads, applications].some((result) => result.rows.length === 10000) } });
  } catch (error) { next(error); }
});

router.get('/dashboard', async (request, response, next) => {
  try {
    const member = request.auth.member; const mine = request.query.scope === 'mine'; const ownerQueries = mine ? [sdk.Query.equal('owner_member_id', [member.user_id])] : []; const targetMember = text(request.query.member_id, 'member_id', 36);
    if (targetMember) {
      if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can filter the dashboard by member.', 403);
      const active = await listRows('members', [sdk.Query.equal('user_id', [targetMember]), sdk.Query.equal('is_active', [true])]); if (!active.rows[0]) throw new AppError('VALIDATION_ERROR', 'Select an active committee member.', 400);
      ownerQueries.push(sdk.Query.equal('owner_member_id', [targetMember]));
    }
    const activityActor = targetMember || (mine ? member.user_id : '');
    const activityQueries = activityActor ? [sdk.Query.equal('actor_user_id', [activityActor])] : [];
    const dashboardFields = {
      companies: ['$id', 'company_name', 'organization_category'],
      leads: ['$id', 'lead_status'],
      communications: ['$id', 'company_id', 'direction', 'channel', 'occurred_at', 'subject', 'message_summary', 'previous_communication_id', 'result_status'],
      opportunities: ['$id', 'opportunity_status', 'details_json'],
      followups: ['$id', 'status', 'due_at'],
      applications: ['$id', 'student_id', 'application_status'],
      resume_shares: ['$id'],
      interviews: ['$id', 'result', 'attendance_status'],
    };
    const [companies, leads, communications, opportunities, followups, applications, resumeShares, interviews, activityResult] = await Promise.all([...Object.entries(dashboardFields).map(([table, fields]) => listRowsComplete(table, [...ownerQueries, sdk.Query.select(fields)])), listRows('activity_logs', [...activityQueries, sdk.Query.select(['$id', 'actor_user_id', 'actor_role', 'action_type', 'entity_type', 'occurred_at', 'changed_fields'])])]);
    const leadsIn = new Set(['NEW', 'RESEARCHING', 'READY_TO_CONTACT']); const activeLeads = new Set(['OUTREACH_STARTED', 'AWAITING_RESPONSE', 'FOLLOW_UP_DUE', 'INTERESTED']);
    const afterForm = new Set(['FORM_FLOATED', 'APPLICATIONS_CLOSED', 'RESUMES_SHARED', 'INTERVIEWS', 'RESULTS_AWAITED', 'COMPLETED']);
    const istDate = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); const today = istDate(Date.now());
    const dueCount = followups.rows.filter((row) => row.status === 'PENDING' && row.due_at && istDate(row.due_at) <= today).length;
    const statusCounts = (rows, field) => { const result = {}; for (const row of rows) { const key = row[field] || 'UNSPECIFIED'; result[key] = (result[key] || 0) + 1; } return result; };
    const companyMap = new Map(companies.rows.map((row) => [row.$id, row.company_name]));
    const channelCounts = statusCounts(communications.rows.filter((row) => row.direction === 'OUTBOUND'), 'channel'); const organizationCounts = statusCounts(companies.rows, 'organization_category');
    const inboundById = new Map(communications.rows.filter((row) => row.direction === 'INBOUND').map((row) => [row.$id, row]));
    const repliedTo = new Set(communications.rows.filter((row) => { const previous = inboundById.get(row.previous_communication_id); return row.direction === 'OUTBOUND' && previous && new Date(row.occurred_at) >= new Date(previous.occurred_at); }).map((row) => row.previous_communication_id));
    const pendingReplies = communications.rows.filter((row) => row.direction === 'INBOUND' && !repliedTo.has(row.$id)).sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()).slice(0, 10).map((row) => ({ id: row.$id, company_name: companyMap.get(row.company_id) || 'Company', subject: row.subject || row.message_summary || 'Inbound reply', occurred_at: row.occurred_at }));
    let activityMemberNames = new Map();
    if (member.role === 'SUPER_ADMIN' && activityResult.rows.length) { const actorIds = [...new Set(activityResult.rows.map((row) => row.actor_user_id))]; const profiles = await Promise.all(actorIds.map(async (actorId) => listRows('members', [sdk.Query.equal('user_id', [actorId]), sdk.Query.limit(1)]))); activityMemberNames = new Map(profiles.map((result, index) => [actorIds[index], result.rows[0]?.full_name || 'Member'])); }
    const recentActivity = activityResult.rows.slice(0, 8).map((row) => ({ id: row.$id, actor: member.role === 'SUPER_ADMIN' ? activityMemberNames.get(row.actor_user_id) || 'Member' : 'Your activity', action: row.action_type, entity: row.entity_type, occurred_at: row.occurred_at, changed_fields: row.changed_fields || [] }));
    const contacted = new Set(communications.rows.filter((row) => row.direction === 'OUTBOUND').map((row) => row.company_id)); const selectedStudents = new Set(applications.rows.filter((row) => row.application_status === 'SELECTED').map((row) => row.student_id));
    const metrics = [
      { label: 'Total companies', count: companies.rows.length, page: 'Companies', help: 'Canonical company records.' },
      { label: 'New leads', count: leads.rows.filter((row) => leadsIn.has(row.lead_status)).length, page: 'Leads', help: 'Leads in New, Researching or Ready to Contact.' },
      { label: 'Leads in progress', count: leads.rows.filter((row) => activeLeads.has(row.lead_status)).length, page: 'Leads', help: 'Leads with active outreach or response work.' },
      { label: 'Companies contacted', count: contacted.size, page: 'Communications', help: 'Distinct companies with outbound communication.' },
      { label: 'Replies received', count: communications.rows.filter((row) => row.direction === 'INBOUND' || row.result_status === 'REPLY_RECEIVED').length, page: 'Communications', help: 'Inbound communication records and logged replies.' },
      { label: 'Replies awaiting response', count: communications.rows.filter((row) => row.direction === 'INBOUND' && !repliedTo.has(row.$id)).length, page: 'Communications', help: 'Inbound events without a later outbound event linked as a reply.' },
      { label: 'JDs received', count: opportunities.rows.filter((row) => { try { const details = JSON.parse(row.details_json || '{}'); return Boolean(details.jd_received_at || details.jd_document_id); } catch { return false; } }).length, page: 'Opportunities', help: 'Opportunities with a recorded JD received date or attached JD file.' },
      { label: 'Forms floated', count: opportunities.rows.filter((row) => afterForm.has(row.opportunity_status)).length, page: 'Opportunities', help: 'Opportunities at Form Floated or a later stage.' },
      { label: 'Student profile shares', count: resumeShares.rows.length, page: 'Opportunities', help: 'Recorded student-profile sharing activity; files are not stored.' },
      { label: 'Interviews ongoing', count: interviews.rows.filter((row) => row.result === 'PENDING' && !['CANCELLED', 'NO_SHOW'].includes(row.attendance_status)).length, page: 'Interviews', help: 'Interview rounds without a recorded outcome.' },
      { label: 'Interviews completed', count: interviews.rows.filter((row) => row.result !== 'PENDING').length, page: 'Interviews', help: 'Interview rounds with a recorded outcome.' },
      { label: 'Selected students', count: selectedStudents.size, page: 'Applications', help: 'Distinct students with a Selected application.' },
      { label: 'Follow-ups due', count: dueCount, page: 'Follow-ups', help: 'Pending follow-ups due on or before today (Asia/Kolkata).' },
    ];
    response.json({ ok: true, data: { scope: mine ? 'mine' : 'all', member_id: targetMember, generated_at: now(), metrics, lead_statuses: statusCounts(leads.rows, 'lead_status'), opportunity_statuses: statusCounts(opportunities.rows, 'opportunity_status'), outreach_channels: channelCounts, organization_categories: organizationCounts, awaiting_replies: pendingReplies, recent_activity: recentActivity }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/reports/summary', async (request, response, next) => {
  try {
    const tables = ['companies', 'contacts', 'leads', 'communications', 'followups', 'opportunities', 'academic_confirmations', 'students', 'applications', 'resume_shares', 'interviews'];
    const member = request.auth.member; const mine = request.query.scope === 'mine'; const ownerQueries = mine ? [sdk.Query.equal('owner_member_id', [member.user_id])] : [];
    const from = text(request.query.from, 'from', 10); const to = text(request.query.to, 'to', 10); const targetMember = text(request.query.member_id, 'member_id', 36);
    const dayStart = (value) => { const calendar = new Date(`${value}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value) throw new AppError('VALIDATION_ERROR', 'Report dates must be valid calendar dates in YYYY-MM-DD format.', 400); return new Date(`${value}T00:00:00+05:30`).toISOString(); };
    if (from && to && from > to) throw new AppError('VALIDATION_ERROR', 'The report start date must be on or before the end date.', 400);
    const rangeQueries = []; if (from) rangeQueries.push(sdk.Query.greaterThanEqual('created_at', dayStart(from))); if (to) rangeQueries.push(sdk.Query.lessThanEqual('created_at', new Date(new Date(dayStart(to)).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString()));
    if (targetMember) {
      if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can filter reports by member.', 403);
      const active = await listRows('members', [sdk.Query.equal('user_id', [targetMember]), sdk.Query.equal('is_active', [true])]); if (!active.rows[0]) throw new AppError('VALIDATION_ERROR', 'Select an active committee member.', 400);
      ownerQueries.push(sdk.Query.equal('owner_member_id', [targetMember]));
    }
    const reportQueries = [...ownerQueries, ...rangeQueries];
    const [counts, leadRows, opportunityRows, applicationRows, resumeShareRows, interviewRows] = await Promise.all([Promise.all(tables.map(async (table) => {
      const result = await listRows(table, reportQueries);
      return { table, count: result.total };
    })), ...['leads', 'opportunities', 'applications', 'resume_shares', 'interviews'].map((table) => listRowsComplete(table, reportQueries))]);
    const [communicationRows, followupRows] = await Promise.all([listRowsComplete('communications', reportQueries), listRowsComplete('followups', reportQueries)]);
    const channelCounts = new Map(); const replyIds = new Set(communicationRows.rows.filter((row) => row.direction === 'INBOUND').map((row) => row.$id)); const repliedIds = new Set(communicationRows.rows.filter((row) => row.direction === 'OUTBOUND' && row.previous_communication_id && replyIds.has(row.previous_communication_id)).map((row) => row.previous_communication_id));
    for (const row of communicationRows.rows) { const key = `${row.channel || 'UNSPECIFIED'} · ${row.direction || 'UNKNOWN'}`; channelCounts.set(key, (channelCounts.get(key) || 0) + 1); }
    const communicationSummary = [...channelCounts.entries()].map(([channel, count]) => ({ channel, count })).sort((a, b) => a.channel.localeCompare(b.channel));
    const inboundCount = communicationRows.rows.filter((row) => row.direction === 'INBOUND').length; const outboundCount = communicationRows.rows.filter((row) => row.direction === 'OUTBOUND').length;
    const replyRate = inboundCount ? Math.round((repliedIds.size / inboundCount) * 1000) / 10 : 0;
    const followupSummary = { pending: followupRows.rows.filter((row) => row.status === 'PENDING').length, completed: followupRows.rows.filter((row) => row.status === 'COMPLETED').length, overdue: followupRows.rows.filter((row) => row.status === 'PENDING' && new Date(row.due_at).getTime() < Date.now()).length };
    const funnel = [];
    for (const [name, rows, field] of [['Leads', leadRows.rows, 'lead_status'], ['Opportunities', opportunityRows.rows, 'opportunity_status'], ['Applications', applicationRows.rows, 'application_status'], ['Interview rounds', interviewRows.rows, 'result']]) {
      const byStatus = new Map();
      for (const row of rows) { const status = row[field] || 'UNSPECIFIED'; byStatus.set(status, (byStatus.get(status) || 0) + 1); }
      for (const [status, count] of [...byStatus.entries()].sort(([a], [b]) => a.localeCompare(b))) funnel.push({ stage: name, status, count });
    }
    if (resumeShareRows.rows.length) funnel.push({ stage: 'Student profile sharing', status: 'SHARED', count: resumeShareRows.rows.length });
    response.json({ ok: true, data: { scope: mine ? 'mine' : 'all', from, to, member_id: targetMember, counts, funnel, outreach: { inbound: inboundCount, outbound: outboundCount, replies: repliedIds.size, reply_rate_percent: replyRate, channels: communicationSummary }, followups: followupSummary, generated_at: now() }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/notifications', async (request, response, next) => {
  try {
    const member = request.auth.member; const horizon = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const ownerQueries = request.query.scope === 'mine' ? [sdk.Query.equal('owner_member_id', [member.user_id])] : [];
    const [followups, confirmations, interviews] = await Promise.all([
      listRowsComplete('followups', [...ownerQueries, sdk.Query.equal('status', ['PENDING'])]),
      listRowsComplete('academic_confirmations', [...ownerQueries, sdk.Query.equal('status', ['PENDING'])]),
      listRowsComplete('interviews', [...ownerQueries, sdk.Query.equal('attendance_status', ['SCHEDULED'])]),
    ]);
    const items = [];
    for (const row of followups.rows) {
      const due = new Date(row.due_at).getTime();
      if (Number.isFinite(due) && due <= horizon) items.push({ id: `followup:${row.$id}`, type: 'FOLLOW_UP', entity_id: row.$id, title: row.title || 'Follow-up due', summary: due < Date.now() ? 'Overdue follow-up' : 'Follow-up due within 7 days', due_at: row.due_at, page: 'Follow-ups' });
    }
    for (const row of confirmations.rows) items.push({ id: `confirmation:${row.$id}`, type: 'CONFIRMATION', entity_id: row.$id, title: `${row.confirmation_type.replaceAll('_', ' ')} confirmation pending`, summary: `Awaiting response from ${row.requested_from.toLowerCase()}`, due_at: row.exam_period_start || row.joining_date || row.created_at, page: 'Academic confirmations' });
    for (const row of interviews.rows) {
      const scheduled = new Date(row.scheduled_at).getTime();
      if (Number.isFinite(scheduled) && scheduled >= Date.now() && scheduled <= horizon) items.push({ id: `interview:${row.$id}`, type: 'INTERVIEW', entity_id: row.$id, title: `${row.round_name.replaceAll('_', ' ')} interview scheduled`, summary: `Round ${row.round_number}`, due_at: row.scheduled_at, page: 'Interviews' });
    }
    items.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
    const visibleItems = items.slice(0, 100);
    const relatedRows = await Promise.all(visibleItems.map(async (item) => {
      const table = { FOLLOW_UP: 'followups', CONFIRMATION: 'academic_confirmations', INTERVIEW: 'interviews' }[item.type];
      const row = await getRow(table, item.entity_id);
      const opportunityId = row.opportunity_id || (row.application_id ? (await getRow('applications', row.application_id)).opportunity_id : '');
      const opportunity = opportunityId ? await getRow('opportunities', opportunityId) : null;
      const application = row.application_id ? await getRow('applications', row.application_id) : null;
      const student = application?.student_id ? await getRow('students', application.student_id) : null;
      const company = row.company_id ? await getRow('companies', row.company_id) : opportunity ? await getRow('companies', opportunity.company_id) : null;
      if (item.type === 'FOLLOW_UP') {
        if (row.contact_id) await getRow('contacts', row.contact_id);
        if (row.lead_id) await getRow('leads', row.lead_id);
        if (row.related_communication_id) await getRow('communications', row.related_communication_id);
      }
      if (item.type === 'CONFIRMATION') {
        if (row.contact_id) await getRow('contacts', row.contact_id);
        if (row.communication_id) await getRow('communications', row.communication_id);
        if (row.document_id) await getRow('documents', row.document_id);
      }
      return { item, row, opportunity, application, student, company };
    }));
    const relationIndex = new Map(relatedRows.map((related) => [related.item.id, related]));
    for (const item of visibleItems) { const related = relationIndex.get(item.id); item.context = [related.company?.company_name, related.opportunity?.title, related.student?.full_name].filter(Boolean).join(' · '); }
    const reads = visibleItems.length ? await listRowsComplete('notification_reads', [sdk.Query.equal('user_id', [member.user_id]), sdk.Query.equal('notification_id', visibleItems.map((item) => item.id))], 100) : { rows: [] };
    const readIds = new Set(reads.rows.map((row) => row.notification_id));
    response.json({ ok: true, data: visibleItems.map((item) => ({ ...item, read: readIds.has(item.id) })), meta: { requestId: requestId(request), total: items.length } });
  } catch (error) { next(error); }
});

router.post('/notifications/read', async (request, response, next) => {
  try {
    const member = request.auth.member; const ids = request.body?.ids;
    if (!Array.isArray(ids) || ids.length > 100) throw new AppError('VALIDATION_ERROR', 'Provide at most 100 notification IDs.', 400);
    const uniqueIds = [...new Set(ids.map((id) => text(id, 'notification_id', 100)))];
    if (uniqueIds.some((id) => !/^(followup|confirmation|interview):[A-Za-z0-9_-]{1,36}$/.test(id))) throw new AppError('VALIDATION_ERROR', 'One or more notification IDs are invalid.', 400);
    const existing = await listRowsComplete('notification_reads', [sdk.Query.equal('user_id', [member.user_id]), sdk.Query.equal('notification_id', uniqueIds)], 100);
    const known = new Set(existing.rows.map((row) => row.notification_id)); const timestamp = now();
    await Promise.all(uniqueIds.filter((id) => !known.has(id)).map(async (notificationId) => {
      const rowId = crypto.createHash('sha256').update(`${member.user_id}:${notificationId}`).digest('hex').slice(0, 36);
      try { await adminTables.createRow(databaseId, 'notification_reads', rowId, { user_id: member.user_id, notification_id: notificationId, read_at: timestamp, created_at: timestamp }); }
      catch (error) { if (error.code !== 409) throw error; }
    }));
    response.json({ ok: true, data: { ids: uniqueIds }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/audit-logs', async (request, response, next) => {
  try {
    if (request.auth.member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can view audit history.', 403);
    const queries = [];
    if (request.query.actor_user_id) queries.push(sdk.Query.equal('actor_user_id', [text(request.query.actor_user_id, 'actor_user_id', 36)]));
    if (request.query.action_type) queries.push(sdk.Query.equal('action_type', [text(request.query.action_type, 'action_type', 32)]));
    if (request.query.entity_type) queries.push(sdk.Query.equal('entity_type', [text(request.query.entity_type, 'entity_type', 64)]));
    if (request.query.entity_id) queries.push(sdk.Query.equal('entity_id', [text(request.query.entity_id, 'entity_id', 36)]));
    const result = await listRowsComplete('activity_logs', queries, 10000);
    const from = request.query.date_from ? new Date(`${text(request.query.date_from, 'date_from', 10)}T00:00:00+05:30`).getTime() : 0;
    const to = request.query.date_to ? new Date(`${text(request.query.date_to, 'date_to', 10)}T23:59:59.999+05:30`).getTime() : Number.MAX_SAFE_INTEGER;
    if (Number.isNaN(from) || Number.isNaN(to)) throw new AppError('VALIDATION_ERROR', 'Date filters must use YYYY-MM-DD.', 400);
    const rows = result.rows.filter((row) => { const occurred = new Date(row.occurred_at).getTime(); return occurred >= from && occurred <= to; });
    const page = Number(request.query.offset || 0); if (!Number.isInteger(page) || page < 0 || page > 100000) throw new AppError('VALIDATION_ERROR', 'offset must be a whole number between 0 and 100,000.', 400);
    response.json({ ok: true, data: rows.slice(page, page + 50).map((row) => ({ id: row.$id, actor_user_id: row.actor_user_id, actor_role: row.actor_role, action_type: row.action_type, entity_type: row.entity_type, entity_id: row.entity_id, changed_fields: row.changed_fields || [], occurred_at: row.occurred_at, request_id: row.request_id, source: row.source })), meta: { requestId: requestId(request), total: rows.length, scanned: result.rows.length, capped: result.rows.length === 10000, offset: page, limit: 50 } });
  } catch (error) { next(error); }
});

router.get('/admin/data-export', async (request, response, next) => {
  try {
    const { member } = request.auth;
    if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can export a full data backup.', 403);
    const tables = ['members', 'companies', 'contacts', 'leads', 'communications', 'followups', 'opportunities', 'academic_confirmations', 'students', 'applications', 'interviews', 'resume_shares', 'templates', 'documents', 'activity_logs', 'legacy_source_rows', 'meeting_notes', 'import_batches', 'import_batch_rows', 'bulk_update_operations', 'bulk_update_rows', 'notification_reads', 'app_settings'];
    const contents = {};
    for (const tableId of tables) contents[tableId] = (await listRowsComplete(tableId, [], 10000)).rows.map((row) => {
      const copy = { ...row };
      for (const key of ['$createdAt', '$updatedAt', '$permissions', '$databaseId', '$tableId']) delete copy[key];
      return copy;
    });
    await audit(member, 'EXPORT', 'database', databaseId, null, { tables: tables.length, row_counts: Object.fromEntries(tables.map((tableId) => [tableId, contents[tableId].length])) }, request);
    response.json({ ok: true, data: { format: 'uktech-tp-json-backup-v1', exported_at: now(), exported_by: member.login_id, database_id: databaseId, tables: contents }, meta: { requestId: requestId(request), table_count: tables.length, capped_at_10000_rows_per_table: true } });
  } catch (error) { next(error); }
});

router.post('/bulk/undo', async (request, response, next) => {
  try {
    const { member } = request.auth;
    const allowlisted = new Set(['companies', 'contacts', 'leads', 'communications', 'followups', 'students', 'applications', 'interviews', 'templates']);
    const input = request.body?.records;
    if (!Array.isArray(input) || input.length < 1 || input.length > 250) throw new AppError('VALIDATION_ERROR', 'Choose between 1 and 250 created records to undo.', 400);
    const unique = [...new Map(input.map((item) => { const table = text(item?.table, 'table', 32); const id = text(item?.id, 'id', 36); if (!allowlisted.has(table) || !id) throw new AppError('VALIDATION_ERROR', 'One or more undo records are invalid.', 400); return [`${table}:${id}`, { table, id }]; })).values()];
    const reverseReferences = {
      companies: [['contacts', 'company_id'], ['leads', 'company_id'], ['opportunities', 'company_id'], ['communications', 'company_id'], ['followups', 'company_id'], ['academic_confirmations', 'company_id'], ['documents', 'related_entity_id'], ['legacy_source_rows', 'company_id']],
      contacts: [['communications', 'contact_id'], ['opportunities', 'contact_id'], ['academic_confirmations', 'contact_id'], ['resume_shares', 'shared_with_contact_id'], ['interviews', 'interviewer_contact_id']],
      leads: [['legacy_source_rows', 'lead_id']],
      communications: [['followups', 'communication_id'], ['academic_confirmations', 'communication_id'], ['resume_shares', 'communication_id'], ['communications', 'previous_communication_id']],
      students: [['applications', 'student_id'], ['resume_shares', 'student_id']],
      applications: [['interviews', 'application_id']],
    };
    const plan = []; const plannedKeys = new Set(unique.map((item) => `${item.table}:${item.id}`));
    for (const item of unique) {
      const row = await getRow(item.table, item.id);
      if (row.created_by !== member.user_id || row.updated_by !== member.user_id || row.updated_at !== row.created_at) throw new AppError('CONFLICT', `Record ${item.id} is not an unchanged record created by your account. No rows were removed.`, 409);
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 30 * 60 * 1000) throw new AppError('CONFLICT', `Undo is available for 30 minutes after creation. Record ${item.id} is outside that window.`, 409);
      const events = await listRowsComplete('activity_logs', [sdk.Query.equal('entity_type', [item.table]), sdk.Query.equal('entity_id', [item.id])]);
      if (events.rows.length !== 1 || events.rows[0].action_type !== 'CREATE') throw new AppError('CONFLICT', `Record ${item.id} has additional activity after creation. No rows were removed.`, 409);
      for (const [refTable, field] of reverseReferences[item.table] || []) {
        const refs = await listRowsComplete(refTable);
        const referring = refs.rows.filter((ref) => ref[field] === item.id && !(refTable === 'documents' && ref.related_entity_type !== 'COMPANY') && !plannedKeys.has(`${refTable}:${ref.$id}`));
        if (referring.length || refs.rows.length >= 10000) throw new AppError('CONFLICT', `Record ${item.id} is referenced by ${refTable}; no rows were removed.`, 409);
      }
      plan.push({ ...item, row });
    }
    for (const item of plan.reverse()) { await adminTables.deleteRow(databaseId, item.table, item.id); await audit(member, 'UNDO_CREATE', item.table, item.id, { created_at: item.row.created_at }, null, request); }
    response.json({ ok: true, data: { deleted: plan.length, records: unique }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.post('/bulk/updates/prepare', async (request, response, next) => {
  try {
    const { member } = request.auth; const tableId = text(request.body?.table_id, 'table_id', 40);
    const allowedFields = BULK_UPDATE_FIELDS[tableId]; const records = request.body?.records;
    if (!allowedFields || !Array.isArray(records) || records.length < 1 || records.length > 250) throw new AppError('VALIDATION_ERROR', 'Provide a supported table and 1 to 250 update rows.', 400);
    if (tableId === 'companies' || tableId === 'students') { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can prepare bulk updates for this module.', 403); }
    const uniqueIds = new Set(); const normalizedRecords = [];
    for (const item of records) {
      const id = text(item?.id, 'id', 36); const fields = [...new Set(Array.isArray(item?.fields) ? item.fields.map((field) => text(field, 'field', 80)) : [])];
      if (!id || uniqueIds.has(id) || !fields.length || fields.some((field) => !allowedFields.includes(field))) throw new AppError('VALIDATION_ERROR', 'Each row needs a unique record ID and supported fields.', 400);
      uniqueIds.add(id); normalizedRecords.push({ id, fields });
    }
    const selectedFields = [...new Set(normalizedRecords.flatMap((item) => item.fields))];
    const ids = [...uniqueIds]; const idBatches = [];
    for (let offset = 0; offset < ids.length; offset += 75) idBatches.push(ids.slice(offset, offset + 75));
    const fetchedBatches = await Promise.all(idBatches.map((idBatch) => listRowsComplete(tableId, [sdk.Query.equal('$id', idBatch), sdk.Query.select(['$id', ...selectedFields])], idBatch.length)));
    const rowsById = new Map(fetchedBatches.flatMap((result) => result.rows).map((row) => [row.$id, row]));
    const prepared = [];
    for (const item of normalizedRecords) {
      const row = rowsById.get(item.id); if (!row) throw new AppError('NOT_FOUND', `Record ${item.id} was not found.`, 404);
      const oldValues = Object.fromEntries(item.fields.map((field) => [field, row[field] ?? null]));
      if (JSON.stringify(oldValues).length > 20000) throw new AppError('PAYLOAD_TOO_LARGE', `Record ${item.id} has fields too large to make a safe rollback snapshot.`, 413);
      prepared.push({ id: item.id, fields: item.fields, oldValues });
    }
    const timestamp = now(); const operation = await adminTables.createRow(databaseId, 'bulk_update_operations', sdk.ID.unique(), { table_id: tableId, created_by: member.user_id, status: 'PREPARED', total_rows: prepared.length, applied_rows: 0, created_at: timestamp, updated_at: timestamp });
    const journalRows = prepared.map((item) => ({ $id: sdk.ID.unique(), data: { operation_id: operation.$id, record_id: item.id, changed_fields: item.fields, old_values: JSON.stringify(item.oldValues), new_values: '', expected_updated_at: '', status: 'PREPARED', created_at: timestamp } }));
    for (let offset = 0; offset < journalRows.length; offset += 25) await adminTables.createRows(databaseId, 'bulk_update_rows', journalRows.slice(offset, offset + 25));
    await audit(member, 'BULK_UPDATE_PREPARE', 'bulk_update_operations', operation.$id, null, { table_id: tableId, total_rows: prepared.length }, request);
    response.status(201).json({ ok: true, data: { id: operation.$id, status: operation.status, total_rows: operation.total_rows }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.post('/bulk/updates/:operationId/undo', async (request, response, next) => {
  try {
    const { member } = request.auth; const operation = await getRow('bulk_update_operations', request.params.operationId);
    if (operation.created_by !== member.user_id) throw new AppError('FORBIDDEN', 'You can only undo a bulk update you started.', 403);
    if (operation.status !== 'PREPARED') throw new AppError('CONFLICT', 'This bulk update has already been undone or closed.', 409);
    const ageMs = Date.now() - new Date(operation.created_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 30 * 60 * 1000) throw new AppError('CONFLICT', 'Undo is available for 30 minutes after the bulk update.', 409);
    const records = (await listRowsComplete('bulk_update_rows', [sdk.Query.equal('operation_id', [operation.$id])], 250)).rows;
    const applied = records.filter((row) => row.status === 'APPLIED');
    if (!applied.length) throw new AppError('CONFLICT', 'No successful updates are available to undo.', 409);
    const plan = [];
    for (const journal of applied) {
      const current = await getRow(operation.table_id, journal.record_id);
      if (current.updated_at !== journal.expected_updated_at) throw new AppError('CONFLICT', `Record ${journal.record_id} changed after this bulk update; nothing was undone.`, 409);
      const oldValues = JSON.parse(journal.old_values); const newValues = JSON.parse(journal.new_values);
      const matches = Object.entries(newValues).every(([field, value]) => JSON.stringify(current[field] ?? null) === JSON.stringify(value));
      if (!matches) throw new AppError('CONFLICT', `Record ${journal.record_id} no longer matches the saved bulk update; nothing was undone.`, 409);
      plan.push({ journal, current, oldValues });
    }
    for (const item of plan) {
      const restored = { ...item.current, ...item.oldValues, updated_at: now(), updated_by: member.user_id };
      delete restored.$id; delete restored.$createdAt; delete restored.$updatedAt; delete restored.$permissions; delete restored.$databaseId; delete restored.$tableId;
      const saved = await adminTables.updateRow(databaseId, operation.table_id, item.journal.record_id, restored);
      await audit(member, 'UNDO_BULK_UPDATE', operation.table_id, saved.$id, item.current, saved, request);
      await adminTables.updateRow(databaseId, 'bulk_update_rows', item.journal.$id, { ...item.journal, status: 'UNDONE' });
    }
    const updated = await adminTables.updateRow(databaseId, 'bulk_update_operations', operation.$id, { ...operation, status: 'UNDONE', applied_rows: 0, updated_at: now() });
    await audit(member, 'UNDO_BULK_UPDATE', 'bulk_update_operations', operation.$id, { status: operation.status }, { status: updated.status, restored_rows: applied.length }, request);
    response.json({ ok: true, data: { id: operation.$id, status: updated.status, restored_rows: applied.length }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.patch('/auth/profile', async (request, response, next) => {
  try {
    const { member, user } = request.auth;
    const body = request.body || {};
    const fullName = body.full_name === undefined ? member.full_name : text(body.full_name, 'full_name', 160);
    const email = body.email === undefined ? String(user.email || member.email).toLowerCase() : text(body.email, 'email', 254).toLowerCase();
    if (!fullName) throw new AppError('VALIDATION_ERROR', 'Full name is required.', 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('VALIDATION_ERROR', 'Enter a valid email address.', 400);
    if (email !== String(user.email || '').toLowerCase()) throw new AppError('VALIDATION_ERROR', 'The profile email must match the signed-in Appwrite account.', 400);
    const updated = await adminTables.updateRow(databaseId, 'members', member.$id, { ...member, full_name: fullName, email, updated_at: now() });
    await audit(member, 'UPDATE', 'members', member.$id, { full_name: member.full_name, email: member.email }, { full_name: fullName, email }, request);
    response.json({ ok: true, data: safeMemberView(updated), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

const DEFAULT_APP_SETTINGS = {
  timezone: 'Asia/Kolkata', date_format: 'DD MMM YYYY', upload_limit_mb: 20,
  industries: ['IT', 'Manufacturing', 'Pharma', 'Cybersecurity', 'Other'],
  organization_categories: ['GOVERNMENT', 'PRIVATE', 'OTHER'],
  branches: ['CSE', 'IT', 'ECE', 'EE', 'ME', 'CE', 'Pharmacy', 'Other'],
  lead_statuses: LEAD_STATUSES, opportunity_statuses: OPPORTUNITY_STATUSES, communication_channels: COMMUNICATION_CHANNELS,
  academic_calendar: { session_year: '', joining_start: '', joining_end: '', examination_start: '', examination_end: '' },
};

router.get('/settings', async (request, response, next) => {
  try {
    if (request.auth.member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can view system settings.', 403);
    const result = await listRows('app_settings', [sdk.Query.equal('setting_key', ['workspace'])]);
    const settings = result.rows[0] ? { ...DEFAULT_APP_SETTINGS, ...JSON.parse(result.rows[0].details_json || '{}') } : DEFAULT_APP_SETTINGS;
    response.json({ ok: true, data: settings, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.put('/settings', async (request, response, next) => {
  try {
    const { member } = request.auth; if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can change system settings.', 403);
    const body = request.body || {}; const candidate = { ...DEFAULT_APP_SETTINGS, ...body };
    if (candidate.timezone !== 'Asia/Kolkata') throw new AppError('VALIDATION_ERROR', 'The placement desk timezone is Asia/Kolkata.', 400);
    if (!['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].includes(candidate.date_format)) throw new AppError('VALIDATION_ERROR', 'Choose a supported date format.', 400);
    if (!Number.isInteger(Number(candidate.upload_limit_mb)) || Number(candidate.upload_limit_mb) < 1 || Number(candidate.upload_limit_mb) > 20) throw new AppError('VALIDATION_ERROR', 'Upload limit must be between 1 and 20 MB.', 400);
    candidate.upload_limit_mb = Number(candidate.upload_limit_mb);
    for (const key of ['industries', 'organization_categories', 'branches', 'lead_statuses', 'opportunity_statuses', 'communication_channels']) {
      if (!Array.isArray(candidate[key]) || candidate[key].length > 100 || candidate[key].some((item) => typeof item !== 'string' || !item.trim() || item.length > 120)) throw new AppError('VALIDATION_ERROR', `${key} must be a list of up to 100 non-empty labels.`, 400);
      candidate[key] = [...new Set(candidate[key].map((item) => item.trim()))];
    }
    if (!candidate.organization_categories.every((value) => ['GOVERNMENT', 'PRIVATE', 'OTHER'].includes(value))) throw new AppError('VALIDATION_ERROR', 'Organization categories must use the supported values.', 400);
    if (!candidate.lead_statuses.every((value) => LEAD_STATUSES.includes(value))) throw new AppError('VALIDATION_ERROR', 'Lead statuses must use the supported workflow values.', 400);
    if (!candidate.opportunity_statuses.every((value) => OPPORTUNITY_STATUSES.includes(value))) throw new AppError('VALIDATION_ERROR', 'Opportunity statuses must use the supported workflow values.', 400);
    if (!candidate.communication_channels.every((value) => COMMUNICATION_CHANNELS.includes(value))) throw new AppError('VALIDATION_ERROR', 'Communication channels must use the supported values.', 400);
    const calendar = candidate.academic_calendar || {};
    for (const key of ['joining_start', 'joining_end', 'examination_start', 'examination_end']) if (calendar[key] && !/^\d{4}-\d{2}-\d{2}$/.test(calendar[key])) throw new AppError('VALIDATION_ERROR', `academic_calendar.${key} must be YYYY-MM-DD.`, 400);
    candidate.academic_calendar = { session_year: text(calendar.session_year, 'session_year', 40), joining_start: calendar.joining_start || '', joining_end: calendar.joining_end || '', examination_start: calendar.examination_start || '', examination_end: calendar.examination_end || '' };
    for (const [start, end] of [['joining_start', 'joining_end'], ['examination_start', 'examination_end']]) if (candidate.academic_calendar[start] && candidate.academic_calendar[end] && candidate.academic_calendar[start] > candidate.academic_calendar[end]) throw new AppError('VALIDATION_ERROR', `${start} must be on or before ${end}.`, 400);
    const existing = await listRows('app_settings', [sdk.Query.equal('setting_key', ['workspace'])]); const data = { setting_key: 'workspace', details_json: JSON.stringify(candidate), updated_at: now(), updated_by: member.user_id };
    const row = existing.rows[0] ? await adminTables.updateRow(databaseId, 'app_settings', existing.rows[0].$id, { ...existing.rows[0], ...data }) : await adminTables.createRow(databaseId, 'app_settings', sdk.ID.unique(), data);
    await audit(member, 'UPDATE', 'app_settings', row.$id, null, { changed_fields: Object.keys(body) }, request);
    response.json({ ok: true, data: candidate, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/members', async (request, response, next) => {
  try {
    if (request.auth.member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can manage Login IDs.', 403);
    const result = await listRowsComplete('members');
    response.json({ ok: true, data: result.rows.map(safeMemberView), meta: { requestId: requestId(request), total: result.total } });
  } catch (error) { next(error); }
});

router.get('/members/:memberId', async (request, response, next) => {
  try {
    if (request.auth.member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can view member details.', 403);
    const row = await getRow('members', request.params.memberId);
    response.json({ ok: true, data: { ...safeMemberView(row), id: row.$id, createdAt: row.created_at || row.$createdAt, updatedAt: row.updated_at || row.$updatedAt }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.post('/members', async (request, response, next) => {
  try {
    const { member } = request.auth;
    if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can create Login IDs.', 403);
    const loginId = text(request.body.login_id, 'login_id', 40).toLowerCase();
    const fullName = text(request.body.full_name, 'full_name', 160);
    const password = text(request.body.password, 'password', 128);
    const role = enumValue(request.body.role, 'role', ['SUPER_ADMIN', 'COMMITTEE_MEMBER'], 'COMMITTEE_MEMBER');
    if (!/^[a-z0-9_]+$/.test(loginId) || !fullName || password.length < 8) throw new AppError('VALIDATION_ERROR', 'Login ID, full name and a password of at least 8 characters are required.', 400);
    const duplicate = await listRows('members', [sdk.Query.equal('login_id', [loginId]), sdk.Query.limit(1)]);
    if (duplicate.rows[0]) throw new AppError('CONFLICT', 'That Login ID already exists.', 409);
    const email = `${loginId}@accounts.uktech.local`;
    const user = await adminUsers.create({ userId: loginId, email, password, name: fullName });
    const timestamp = now();
    const data = { login_id: loginId, user_id: user.$id, full_name: fullName, email, role, is_active: true, permissions_json: JSON.stringify({ ...DEFAULT_PERMISSIONS }), created_at: timestamp, updated_at: timestamp };
    const row = await adminTables.createRow(databaseId, 'members', sdk.ID.unique(), data);
    await audit(member, 'CREATE', 'members', row.$id, null, { login_id: loginId, full_name: fullName, role }, request);
    response.status(201).json({ ok: true, data: safeMemberView(row), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.patch('/members/:memberId', async (request, response, next) => {
  try {
    const { member: actor } = request.auth;
    if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can edit Login IDs.', 403);
    const existing = await getRow('members', request.params.memberId);
    const body = request.body || {};
    const allowed = ['full_name', 'role', 'is_active', 'permissions'];
    const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const fullName = body.full_name === undefined ? existing.full_name : text(body.full_name, 'full_name', 160);
    if (!fullName) throw new AppError('VALIDATION_ERROR', 'Full name is required.', 400);
    const role = body.role === undefined ? existing.role : enumValue(body.role, 'role', ROLES);
    const isActive = body.is_active === undefined ? existing.is_active : body.is_active;
    if (typeof isActive !== 'boolean') throw new AppError('VALIDATION_ERROR', 'is_active must be true or false.', 400);
    if (existing.user_id === actor.user_id && (!isActive || role !== 'SUPER_ADMIN')) throw new AppError('VALIDATION_ERROR', 'You cannot deactivate or demote your own account.', 400);
    let permissions = memberPermissions(existing);
    if (body.permissions !== undefined) {
      if (!body.permissions || typeof body.permissions !== 'object' || Array.isArray(body.permissions)) throw new AppError('VALIDATION_ERROR', 'permissions must be a module-to-access map.', 400);
      const unknownModules = Object.keys(body.permissions).filter((module) => !PERMISSION_MODULES.includes(module));
      if (unknownModules.length) throw new AppError('VALIDATION_ERROR', `Unknown permission modules: ${unknownModules.join(', ')}.`, 400);
      permissions = { ...permissions, ...body.permissions };
      if (Object.values(permissions).some((value) => !['NONE', 'READ', 'WRITE'].includes(value))) throw new AppError('VALIDATION_ERROR', 'Each permission must be NONE, READ or WRITE.', 400);
    }
    if (role === 'SUPER_ADMIN') permissions = { ...DEFAULT_PERMISSIONS };
    const updated = await adminTables.updateRow(databaseId, 'members', existing.$id, { ...existing, full_name: fullName, role, is_active: isActive, permissions_json: JSON.stringify(permissions), updated_at: now() });
    await adminUsers.updateName(existing.user_id, fullName);
    await audit(actor, body.permissions !== undefined ? 'PERMISSION_CHANGE' : 'UPDATE', 'members', existing.$id, { full_name: existing.full_name, role: existing.role, is_active: existing.is_active, permissions: memberPermissions(existing) }, { full_name: fullName, role, is_active: isActive, permissions }, request);
    response.json({ ok: true, data: safeMemberView(updated), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.delete('/members/:memberId', async (request, response, next) => {
  try {
    const { member: actor } = request.auth;
    if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can delete Login IDs.', 403);
    const existing = await getRow('members', request.params.memberId);
    if (existing.user_id === actor.user_id) throw new AppError('VALIDATION_ERROR', 'You cannot delete your own account.', 400);
    const remainingAdmins = await listRows('members', [sdk.Query.equal('role', ['SUPER_ADMIN']), sdk.Query.equal('is_active', [true])]);
    if (existing.role === 'SUPER_ADMIN' && remainingAdmins.rows.filter((row) => row.user_id !== existing.user_id).length === 0) throw new AppError('VALIDATION_ERROR', 'At least one active Super Admin must remain.', 400);
    await adminTables.deleteRow(databaseId, 'members', existing.$id);
    try { await adminUsers.delete(existing.user_id); } catch (error) {
      await adminTables.createRow(databaseId, 'members', existing.$id, existing);
      throw error;
    }
    await audit(actor, 'DELETE', 'members', existing.$id, { login_id: existing.login_id, full_name: existing.full_name, role: existing.role }, null, request);
    response.json({ ok: true, data: { id: existing.$id }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/templates', async (request, response, next) => {
  try {
    const result = await listRowsComplete('templates', [sdk.Query.equal('is_archived', [false])]);
    response.json({ ok: true, data: result.rows.map((row) => ({ id: row.$id, title: row.title, category: row.category, channel: row.channel, subject: row.subject, body: row.body, variables: row.variables || [], isActive: row.is_active })), meta: { requestId: requestId(request), total: result.total } });
  } catch (error) { next(error); }
});

router.get('/meeting-notes', async (request, response, next) => {
  try {
    const result = await listRowsComplete('meeting_notes');
    response.json({ ok: true, data: result.rows.map((row) => safeBusinessView(row, request.auth.member)), meta: { requestId: requestId(request), total: result.rows.length } });
  } catch (error) { next(error); }
});

router.get('/meeting-notes/:noteId', async (request, response, next) => {
  try {
    const row = await getRow('meeting_notes', request.params.noteId);
    response.json({ ok: true, data: safeBusinessView(row, request.auth.member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/legacy-source-rows', async (request, response, next) => {
  try {
    const { member } = request.auth;
    if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can inspect imported source rows.', 403);
    const offset = Number(request.query.offset || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 5000) throw new AppError('VALIDATION_ERROR', 'offset must be a whole number between 0 and 5,000.', 400);
    const queries = [sdk.Query.offset(offset)];
    if (request.query.source_file) queries.push(sdk.Query.equal('source_file', [text(request.query.source_file, 'source_file', 500)]));
    const pageQueries = [...queries, sdk.Query.limit(50), sdk.Query.orderAsc('source_file'), sdk.Query.orderAsc('source_sheet'), sdk.Query.orderAsc('source_row')];
    const result = await adminTables.listRows({ databaseId, tableId: 'legacy_source_rows', queries: pageQueries });
    response.json({ ok: true, data: result.rows.map((row) => ({ id: row.$id, source_file: row.source_file, source_sheet: row.source_sheet, source_row: row.source_row, company_id: row.company_id, contact_id: row.contact_id, lead_id: row.lead_id, skip_reason: row.skip_reason })), meta: { requestId: requestId(request), total: result.total, limit: 50, offset } });
  } catch (error) { next(error); }
});

router.get('/legacy-source-files', async (request, response, next) => {
  try {
    if (request.auth.member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can inspect imported source rows.', 403);
    if (legacySourceFilesCache.expiresAt <= Date.now()) {
      const names = new Set(); let total = 0;
      for (let offset = 0; offset < 10000; offset += 1000) {
        const result = await adminTables.listRows({ databaseId, tableId: 'legacy_source_rows', queries: [sdk.Query.select(['source_file']), sdk.Query.limit(1000), sdk.Query.offset(offset)] });
        total = result.total;
        for (const row of result.rows) if (row.source_file) names.add(row.source_file);
        if (result.rows.length < 1000 || names.size >= total || offset + result.rows.length >= 10000) break;
      }
      legacySourceFilesCache = { expiresAt: Date.now() + 5 * 60 * 1000, files: [...names].sort((a, b) => a.localeCompare(b)), total };
    }
    response.json({ ok: true, data: legacySourceFilesCache.files, meta: { requestId: requestId(request), total: legacySourceFilesCache.total } });
  } catch (error) { next(error); }
});

router.get('/legacy-source-rows/:rowId', async (request, response, next) => {
  try {
    if (request.auth.member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can inspect imported source rows.', 403);
    const row = await getRow('legacy_source_rows', request.params.rowId);
    response.json({ ok: true, data: row, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.post('/templates', async (request, response, next) => {
  try {
    const { member } = request.auth; const body = request.body || {}; const timestamp = now(); const title = text(body.title, 'title', 200); const message = text(body.body, 'body', 10000); const isActive = body.is_active === undefined ? true : body.is_active;
    if (!title || !message) throw new AppError('VALIDATION_ERROR', 'Template title and body are required.', 400);
    if (typeof isActive !== 'boolean') throw new AppError('VALIDATION_ERROR', 'is_active must be true or false.', 400);
    const data = { title, category: text(body.category, 'category', 80) || 'GENERAL_OUTREACH', channel: enumValue(body.channel, 'channel', ['EMAIL', 'LINKEDIN', 'OTHER']), subject: text(body.subject, 'subject', 300), body: message, variables: stringArray(body.variables, 'variables'), is_active: isActive, is_archived: false, created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id };
    const row = await adminTables.createRow(databaseId, 'templates', sdk.ID.unique(), data); await audit(member, 'CREATE', 'templates', row.$id, null, { ...data, body: '[template content]' }, request);
    response.status(201).json({ ok: true, data: { id: row.$id, title: row.title, category: row.category, channel: row.channel, subject: row.subject, body: row.body, variables: row.variables || [], isActive: row.is_active }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.patch('/templates/:templateId', async (request, response, next) => {
  try {
    const { member } = request.auth; const existing = await getRow('templates', request.params.templateId); if (existing.is_archived) throw new AppError('NOT_FOUND', 'Template not found.', 404); const body = request.body || {};
    const allowed = ['title', 'category', 'channel', 'subject', 'body', 'variables', 'is_active']; const unknown = Object.keys(body).filter((key) => !allowed.includes(key)); if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const data = { ...existing }; if (body.title !== undefined) data.title = text(body.title, 'title', 200); if (body.category !== undefined) data.category = text(body.category, 'category', 80); if (body.channel !== undefined) data.channel = enumValue(body.channel, 'channel', ['EMAIL', 'LINKEDIN', 'OTHER']); if (body.subject !== undefined) data.subject = text(body.subject, 'subject', 300); if (body.body !== undefined) data.body = text(body.body, 'body', 10000); if (body.variables !== undefined) data.variables = stringArray(body.variables, 'variables'); if (body.is_active !== undefined) { if (typeof body.is_active !== 'boolean') throw new AppError('VALIDATION_ERROR', 'is_active must be true or false.', 400); data.is_active = body.is_active; }
    if (!data.title || !data.body) throw new AppError('VALIDATION_ERROR', 'Template title and body are required.', 400);
    data.updated_at = now(); data.updated_by = member.user_id; const row = await adminTables.updateRow(databaseId, 'templates', existing.$id, data); await audit(member, 'UPDATE', 'templates', row.$id, { title: existing.title, category: existing.category }, { title: data.title, category: data.category }, request);
    response.json({ ok: true, data: { id: row.$id, title: row.title, category: row.category, channel: row.channel, subject: row.subject, body: row.body, variables: row.variables || [], isActive: row.is_active }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.delete('/templates/:templateId', async (request, response, next) => {
  try {
    const { member } = request.auth; if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can archive templates.', 403); const existing = await getRow('templates', request.params.templateId);
    const row = await adminTables.updateRow(databaseId, 'templates', existing.$id, { ...existing, is_archived: true, is_active: false, updated_at: now(), updated_by: member.user_id }); await audit(member, 'ARCHIVE', 'templates', row.$id, { is_archived: existing.is_archived, is_active: existing.is_active }, { is_archived: true, is_active: false }, request);
    response.json({ ok: true, data: { id: row.$id, is_archived: true }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/companies', async (request, response, next) => {
  try {
    const { member } = request.auth;
    const queries = [];
    if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [member.user_id]));
    if (request.query.status) queries.push(sdk.Query.equal('company_status', [enumValue(request.query.status, 'status', COMPANY_STATUSES)]));
    if (request.query.category) queries.push(sdk.Query.equal('organization_category', [enumValue(request.query.category, 'category', COMPANY_CATEGORIES)]));
    const result = await listRowsComplete('companies', queries);
    response.json({ ok: true, data: result.rows.map((row) => safeBusinessView(row, member)), meta: { requestId: requestId(request), total: result.total, limit: MAX_LIMIT } });
  } catch (error) { next(error); }
});

router.get('/companies/:companyId', async (request, response, next) => {
  try {
    const member = request.auth.member; const row = await getRow('companies', request.params.companyId);

    const [contacts, leads, communications, followups, opportunities] = await Promise.all([
      listRowsComplete('contacts', [sdk.Query.equal('company_id', [row.$id])]), listRowsComplete('leads', [sdk.Query.equal('company_id', [row.$id])]),
      listRowsComplete('communications', [sdk.Query.equal('company_id', [row.$id])]), listRowsComplete('followups', [sdk.Query.equal('company_id', [row.$id])]),
      listRowsComplete('opportunities', [sdk.Query.equal('company_id', [row.$id])]),
    ]);
    response.json({ ok: true, data: { company: safeBusinessView(row, member), related: {
      contacts: contacts.rows.map((item) => safeBusinessView(item, member)), leads: leads.rows.map((item) => safeBusinessView(item, member)),
      communications: communications.rows.map((item) => safeBusinessView(item, member)), followups: followups.rows.map((item) => safeBusinessView(item, member)),
      opportunities: opportunities.rows.map((item) => safeBusinessView(item, member)),
    } }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.post('/companies', async (request, response, next) => {
  try {
    const { member } = request.auth;
    const companyName = text(request.body.company_name, 'company_name', 200);
    if (!companyName) throw new AppError('VALIDATION_ERROR', 'Company name is required.', 400, { company_name: 'Required.' });
    const normalized = normalizedName(companyName);
    const duplicate = await listRows('companies', [sdk.Query.equal('normalized_name', [normalized]), sdk.Query.limit(1)]);
    if (duplicate.rows[0]) throw new AppError('DUPLICATE_CANDIDATE', 'A company with this normalized name already exists. Review it before creating another record.', 409);
    const owner = await resolveOwner(member, request.body.assign_to_member_id);
    const timestamp = now();
    const data = {
      company_name: companyName, normalized_name: normalized,
      website: url(request.body.website, 'website'), careers_url: url(request.body.careers_url, 'careers_url'), linkedin_url: url(request.body.linkedin_url, 'linkedin_url'),
      industry: text(request.body.industry, 'industry', 120), sector: text(request.body.sector, 'sector', 120), organization_type: text(request.body.organization_type, 'organization_type', 120),
      organization_category: enumValue(request.body.organization_category, 'organization_category', COMPANY_CATEGORIES, 'PRIVATE'), city: text(request.body.city, 'city', 100), state: text(request.body.state, 'state', 100), country: text(request.body.country, 'country', 100) || 'India', full_address: text(request.body.full_address, 'full_address', 500),
      general_email: email(request.body.general_email, 'general_email'), general_phone: text(request.body.general_phone, 'general_phone', 40), company_description: text(request.body.company_description, 'company_description', 5000), target_branches: stringArray(request.body.target_branches, 'target_branches'), source_urls: stringArray(request.body.source_urls, 'source_urls'), source_notes: text(request.body.source_notes, 'source_notes', 5000),
      company_status: enumValue(request.body.company_status, 'company_status', COMPANY_STATUSES, 'ACTIVE'), owner_member_id: owner, created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id, is_archived: false,
    };
    const row = await adminTables.createRow(databaseId, 'companies', sdk.ID.unique(), data);
    await audit(member, 'CREATE', 'companies', row.$id, null, data, request);
    response.status(201).json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.patch('/companies/:companyId', async (request, response, next) => {
  try {
    const { member } = request.auth; const existing = await getRow('companies', request.params.companyId); const body = request.body || {};
    const allowed = ['company_name', 'website', 'careers_url', 'linkedin_url', 'industry', 'sector', 'organization_type', 'organization_category', 'city', 'state', 'country', 'full_address', 'general_email', 'general_phone', 'company_description', 'target_branches', 'source_urls', 'source_notes', 'company_status'];
    const unknown = Object.keys(body).filter((key) => !allowed.includes(key) && key !== 'assign_to_member_id');
    if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const data = { ...existing };
    if (body.company_name !== undefined) { data.company_name = text(body.company_name, 'company_name', 200); data.normalized_name = normalizedName(data.company_name); }
    for (const field of ['industry', 'sector', 'organization_type', 'city', 'state', 'country', 'full_address', 'general_phone', 'company_description', 'source_notes']) if (body[field] !== undefined) data[field] = text(body[field], field, field === 'company_description' || field === 'source_notes' ? 5000 : 500);
    for (const field of ['website', 'careers_url', 'linkedin_url']) if (body[field] !== undefined) data[field] = url(body[field], field);
    if (body.general_email !== undefined) data.general_email = email(body.general_email, 'general_email');
    if (body.target_branches !== undefined) data.target_branches = stringArray(body.target_branches, 'target_branches');
    if (body.source_urls !== undefined) data.source_urls = stringArray(body.source_urls, 'source_urls');
    if (body.organization_category !== undefined) data.organization_category = enumValue(body.organization_category, 'organization_category', COMPANY_CATEGORIES);
    if (body.company_status !== undefined) data.company_status = enumValue(body.company_status, 'company_status', COMPANY_STATUSES);
    if (body.assign_to_member_id !== undefined) { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign ownership.', 403); data.owner_member_id = await resolveOwner(member, body.assign_to_member_id); }
    data.updated_at = now(); data.updated_by = member.user_id;
    const row = await adminTables.updateRow(databaseId, 'companies', existing.$id, data);
    await audit(member, body.assign_to_member_id ? 'ASSIGN' : 'UPDATE', 'companies', row.$id, existing, data, request);
    response.json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/contacts', async (request, response, next) => {
  try { const queries = []; if (request.query.company_id) queries.push(sdk.Query.equal('company_id', [request.query.company_id])); if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [request.auth.member.user_id])); const result = await listRowsComplete('contacts', queries); response.json({ ok: true, data: result.rows.map((row) => safeBusinessView(row, request.auth.member)), meta: { requestId: requestId(request), total: result.rows.length } }); } catch (error) { next(error); }
});

router.post('/contacts', async (request, response, next) => {
  try { const { member } = request.auth; const company = await requireCompany(request.body.company_id);  const timestamp = now(); const workEmail = email(request.body.work_email, 'work_email'); const owner = await resolveOwner(member, request.body.assign_to_member_id); const data = { company_id: text(request.body.company_id, 'company_id', 36), full_name: text(request.body.full_name, 'full_name', 160), first_name: text(request.body.first_name, 'first_name', 80), last_name: text(request.body.last_name, 'last_name', 80), designation: text(request.body.designation, 'designation', 120), department: text(request.body.department, 'department', 120), contact_context: text(request.body.contact_context, 'contact_context', 3000), work_email: workEmail, normalized_email: workEmail, alternate_email: email(request.body.alternate_email, 'alternate_email'), phone: text(request.body.phone, 'phone', 40), linkedin_url: url(request.body.linkedin_url, 'linkedin_url'), country: text(request.body.country, 'country', 100), city: text(request.body.city, 'city', 100), preferred_channel: text(request.body.preferred_channel, 'preferred_channel', 32), is_primary_contact: Boolean(request.body.is_primary_contact), contact_status: enumValue(request.body.contact_status, 'contact_status', ['UNVERIFIED', 'VERIFIED', 'INVALID', 'LEFT_COMPANY', 'DO_NOT_CONTACT'], 'UNVERIFIED'), source_urls: stringArray(request.body.source_urls, 'source_urls'), source_notes: text(request.body.source_notes, 'source_notes', 3000), owner_member_id: owner, created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id }; const row = await adminTables.createRow(databaseId, 'contacts', sdk.ID.unique(), data); await audit(member, 'CREATE', 'contacts', row.$id, null, data, request); response.status(201).json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } }); } catch (error) { next(error); }
});

router.get('/contacts/:contactId', async (request, response, next) => {
  try { const row = await getRow('contacts', request.params.contactId);  response.json({ ok: true, data: safeBusinessView(row, request.auth.member), meta: { requestId: requestId(request) } }); } catch (error) { next(error); }
});

router.patch('/contacts/:contactId', async (request, response, next) => {
  try {
    const { member } = request.auth; const existing = await getRow('contacts', request.params.contactId); const body = request.body || {};
    const allowed = ['company_id', 'full_name', 'first_name', 'last_name', 'designation', 'department', 'contact_context', 'work_email', 'alternate_email', 'phone', 'linkedin_url', 'country', 'city', 'preferred_channel', 'is_primary_contact', 'contact_status', 'source_urls', 'source_notes', 'assign_to_member_id'];
    const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const data = { ...existing };
    if (body.company_id !== undefined) { const company = await requireCompany(body.company_id);  data.company_id = text(body.company_id, 'company_id', 36); }
    for (const field of ['full_name', 'first_name', 'last_name', 'designation', 'department', 'country', 'city', 'phone', 'preferred_channel', 'contact_context', 'source_notes']) if (body[field] !== undefined) data[field] = text(body[field], field, ['contact_context', 'source_notes'].includes(field) ? 3000 : 160);
    if (body.work_email !== undefined) { data.work_email = email(body.work_email, 'work_email'); data.normalized_email = data.work_email; }
    if (body.alternate_email !== undefined) data.alternate_email = email(body.alternate_email, 'alternate_email');
    if (body.linkedin_url !== undefined) data.linkedin_url = url(body.linkedin_url, 'linkedin_url');
    if (body.source_urls !== undefined) data.source_urls = stringArray(body.source_urls, 'source_urls');
    if (body.contact_status !== undefined) data.contact_status = enumValue(body.contact_status, 'contact_status', ['UNVERIFIED', 'VERIFIED', 'INVALID', 'LEFT_COMPANY', 'DO_NOT_CONTACT']);
    if (body.is_primary_contact !== undefined) data.is_primary_contact = Boolean(body.is_primary_contact);
    if (body.assign_to_member_id !== undefined) { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign ownership.', 403); data.owner_member_id = await resolveOwner(member, body.assign_to_member_id); }
    data.updated_at = now(); data.updated_by = member.user_id;
    const row = await adminTables.updateRow(databaseId, 'contacts', existing.$id, data);
    await audit(member, body.assign_to_member_id ? 'ASSIGN' : 'UPDATE', 'contacts', row.$id, existing, data, request);
    response.json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/leads', async (request, response, next) => {
  try { const queries = []; if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [request.auth.member.user_id])); if (request.query.status) queries.push(sdk.Query.equal('lead_status', [enumValue(request.query.status, 'status', LEAD_STATUSES)])); const result = await listRowsPage('leads', queries, request); response.json({ ok: true, data: result.rows.map((row) => safeBusinessView(row, request.auth.member)), meta: { requestId: requestId(request), total: result.total, page: result.page, limit: result.limit, pages: result.pages } }); } catch (error) { next(error); }
});

router.post('/leads', async (request, response, next) => {
  try { const { member } = request.auth; const company = await requireCompany(request.body.company_id);  const timestamp = now(); const owner = await resolveOwner(member, request.body.assign_to_member_id); const data = { company_id: text(request.body.company_id, 'company_id', 36), lead_source: enumValue(request.body.lead_source, 'lead_source', LEAD_SOURCES), source_details: text(request.body.source_details, 'source_details', 2000), research_notes: text(request.body.research_notes, 'research_notes', 5000), target_department: text(request.body.target_department, 'target_department', 160), lead_status: enumValue(request.body.lead_status, 'lead_status', LEAD_STATUSES, 'NEW'), priority: enumValue(request.body.priority, 'priority', PRIORITIES, 'NORMAL'), owner_member_id: owner, assigned_member_id: member.role === 'SUPER_ADMIN' ? text(request.body.assign_to_member_id, 'assign_to_member_id', 36) : member.user_id, created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id, is_archived: false }; const row = await adminTables.createRow(databaseId, 'leads', sdk.ID.unique(), data); await audit(member, 'CREATE', 'leads', row.$id, null, data, request); response.status(201).json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } }); } catch (error) { next(error); }
});

router.get('/leads/:leadId', async (request, response, next) => {
  try { const row = await getRow('leads', request.params.leadId);  response.json({ ok: true, data: safeBusinessView(row, request.auth.member), meta: { requestId: requestId(request) } }); } catch (error) { next(error); }
});

router.patch('/leads/:leadId', async (request, response, next) => {
  try { const { member } = request.auth; const existing = await getRow('leads', request.params.leadId); const body = request.body || {};  const allowed = ['company_id', 'lead_source', 'source_details', 'research_notes', 'target_department', 'lead_status', 'priority', 'last_contacted_at', 'next_followup_at', 'is_archived', 'assign_to_member_id']; const unknown = Object.keys(body).filter((key) => !allowed.includes(key)); if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400); const data = { ...existing }; if (body.company_id !== undefined) { const company = await requireCompany(body.company_id);  data.company_id = text(body.company_id, 'company_id', 36); } if (body.lead_source !== undefined) data.lead_source = enumValue(body.lead_source, 'lead_source', LEAD_SOURCES); if (body.lead_status !== undefined) data.lead_status = enumValue(body.lead_status, 'lead_status', LEAD_STATUSES); if (body.priority !== undefined) data.priority = enumValue(body.priority, 'priority', PRIORITIES); for (const field of ['source_details', 'research_notes', 'target_department']) if (body[field] !== undefined) data[field] = text(body[field], field, field === 'research_notes' ? 5000 : 2000); for (const field of ['last_contacted_at', 'next_followup_at']) if (body[field] !== undefined) data[field] = body[field] ? new Date(body[field]).toISOString() : ''; if (body.is_archived !== undefined) data.is_archived = Boolean(body.is_archived); if (body.assign_to_member_id !== undefined) { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign ownership.', 403); data.owner_member_id = await resolveOwner(member, body.assign_to_member_id); data.assigned_member_id = body.assign_to_member_id; } data.updated_at = now(); data.updated_by = member.user_id; const row = await adminTables.updateRow(databaseId, 'leads', existing.$id, data); await audit(member, body.assign_to_member_id !== undefined ? 'ASSIGN' : body.lead_status ? 'STATUS_CHANGE' : 'UPDATE', 'leads', row.$id, existing, data, request); response.json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } }); } catch (error) { next(error); }
});

router.get('/communications', async (request, response, next) => {
  try {
    const queries = [];
    if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [request.auth.member.user_id]));
    if (request.query.company_id) queries.push(sdk.Query.equal('company_id', [request.query.company_id]));
    if (request.query.channel) queries.push(sdk.Query.equal('channel', [enumValue(request.query.channel, 'channel', COMMUNICATION_CHANNELS)]));
    if (request.query.direction) queries.push(sdk.Query.equal('direction', [enumValue(request.query.direction, 'direction', ['INBOUND', 'OUTBOUND'])]));
    const result = await listRowsComplete('communications', queries);
    const ordered = [...result.rows].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    response.json({ ok: true, data: ordered.map((row) => safeBusinessView(row, request.auth.member)), meta: { requestId: requestId(request), total: ordered.length } });
  } catch (error) { next(error); }
});

router.post('/communications', async (request, response, next) => {
  try {
    const { member } = request.auth; const body = request.body || {}; const companyId = text(body.company_id, 'company_id', 36);
    const company = await requireCompany(companyId);
    const timestamp = now(); const owner = await resolveOwner(member, body.assign_to_member_id);
    const data = {
      company_id: companyId,
      contact_id: await optionalRelated('contacts', text(body.contact_id, 'contact_id', 36), companyId),
      lead_id: await optionalRelated('leads', text(body.lead_id, 'lead_id', 36), companyId),
      opportunity_id: body.opportunity_id ? await optionalRelated('opportunities', text(body.opportunity_id, 'opportunity_id', 36), companyId) : '',
      channel: enumValue(body.channel, 'channel', COMMUNICATION_CHANNELS), direction: enumValue(body.direction, 'direction', ['OUTBOUND', 'INBOUND']),
      subject: text(body.subject, 'subject', 300), message_summary: text(body.message_summary, 'message_summary', 2000), message_body: text(body.message_body, 'message_body', 10000),
      template_id: text(body.template_id, 'template_id', 36), sender_account_label: text(body.sender_account_label, 'sender_account_label', 40), recipient: text(body.recipient, 'recipient', 320),
      occurred_at: dateValue(body.occurred_at, 'occurred_at', true), sent_by_user_id: member.user_id,
      result_status: enumValue(body.result_status, 'result_status', COMMUNICATION_RESULTS),
      response_category: body.response_category ? enumValue(body.response_category, 'response_category', RESPONSE_CATEGORIES) : '',
      previous_communication_id: body.previous_communication_id ? await getRow('communications', text(body.previous_communication_id, 'previous_communication_id', 36)).then((previous) => { if (previous.company_id !== companyId) throw new AppError('VALIDATION_ERROR', 'Previous communication must belong to the selected company.', 400);  return previous.$id; }) : '', external_thread_reference: text(body.external_thread_reference, 'external_thread_reference', 200), attachment_document_ids: await validateCommunicationAttachments(body.attachment_document_ids, companyId),
      owner_member_id: owner, created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id,
    };
    if (!data.subject && !data.message_summary) throw new AppError('VALIDATION_ERROR', 'Add a subject or short summary.', 400);
    const row = await adminTables.createRow(databaseId, 'communications', sdk.ID.unique(), data);
    await audit(member, 'CREATE', 'communications', row.$id, null, { ...data, message_body: data.message_body ? '[recorded]' : '' }, request);
    response.status(201).json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.patch('/communications/:communicationId', async (request, response, next) => {
  try {
    const { member } = request.auth; const existing = await getRow('communications', request.params.communicationId); const body = request.body || {};
    const allowed = ['company_id', 'contact_id', 'lead_id', 'opportunity_id', 'channel', 'direction', 'subject', 'message_summary', 'message_body', 'sender_account_label', 'recipient', 'occurred_at', 'result_status', 'response_category', 'previous_communication_id', 'external_thread_reference', 'assign_to_member_id'];
    const unknown = Object.keys(body).filter((key) => !allowed.includes(key)); if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const data = { ...existing }; if (body.company_id !== undefined) data.company_id = text(body.company_id, 'company_id', 36); const company = await requireCompany(data.company_id);
    if (body.contact_id !== undefined) data.contact_id = text(body.contact_id, 'contact_id', 36);
    if (body.lead_id !== undefined) data.lead_id = text(body.lead_id, 'lead_id', 36);
    if (body.opportunity_id !== undefined) data.opportunity_id = text(body.opportunity_id, 'opportunity_id', 36);
    data.contact_id = await optionalRelated('contacts', data.contact_id, data.company_id); data.lead_id = await optionalRelated('leads', data.lead_id, data.company_id); data.opportunity_id = await optionalRelated('opportunities', data.opportunity_id, data.company_id);
    if (body.channel !== undefined) data.channel = enumValue(body.channel, 'channel', COMMUNICATION_CHANNELS); if (body.direction !== undefined) data.direction = enumValue(body.direction, 'direction', ['INBOUND', 'OUTBOUND']);
    if (body.subject !== undefined) data.subject = text(body.subject, 'subject', 300); if (body.message_summary !== undefined) data.message_summary = text(body.message_summary, 'message_summary', 2000); if (body.message_body !== undefined) data.message_body = text(body.message_body, 'message_body', 10000);
    if (body.sender_account_label !== undefined) data.sender_account_label = text(body.sender_account_label, 'sender_account_label', 40); if (body.recipient !== undefined) data.recipient = text(body.recipient, 'recipient', 320); if (body.occurred_at !== undefined) data.occurred_at = dateValue(body.occurred_at, 'occurred_at', true);
    if (body.result_status !== undefined) data.result_status = enumValue(body.result_status, 'result_status', COMMUNICATION_RESULTS); if (body.response_category !== undefined) data.response_category = body.response_category ? enumValue(body.response_category, 'response_category', RESPONSE_CATEGORIES) : '';
    if (body.previous_communication_id !== undefined) data.previous_communication_id = body.previous_communication_id ? await getRow('communications', text(body.previous_communication_id, 'previous_communication_id', 36)).then((previous) => { if (previous.company_id !== data.company_id) throw new AppError('VALIDATION_ERROR', 'Previous communication must belong to the selected company.', 400);  return previous.$id; }) : '';
    else if (data.previous_communication_id) { const previous = await getRow('communications', data.previous_communication_id); if (previous.company_id !== data.company_id) throw new AppError('VALIDATION_ERROR', 'Previous communication must belong to the selected company.', 400);  }
    if (body.external_thread_reference !== undefined) data.external_thread_reference = text(body.external_thread_reference, 'external_thread_reference', 200);
    if (body.attachment_document_ids !== undefined) data.attachment_document_ids = await validateCommunicationAttachments(body.attachment_document_ids, data.company_id);
    if (body.assign_to_member_id !== undefined) { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign ownership.', 403); data.owner_member_id = await resolveOwner(member, body.assign_to_member_id); }
    if (!data.subject && !data.message_summary) throw new AppError('VALIDATION_ERROR', 'Add a subject or short summary.', 400);
    data.updated_at = now(); data.updated_by = member.user_id; const row = await adminTables.updateRow(databaseId, 'communications', existing.$id, data);
    const auditOld = { ...existing, message_body: existing.message_body ? '[recorded]' : '' }; const auditNew = { ...data, message_body: data.message_body ? '[recorded]' : '' }; await audit(member, body.assign_to_member_id !== undefined ? 'ASSIGN' : 'UPDATE', 'communications', row.$id, auditOld, auditNew, request);
    response.json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/followups', async (request, response, next) => {
  try {
    const queries = [];
    if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [request.auth.member.user_id]));
    if (request.query.status) queries.push(sdk.Query.equal('status', [enumValue(request.query.status, 'status', FOLLOWUP_STATUSES)]));
    if (request.query.company_id) queries.push(sdk.Query.equal('company_id', [request.query.company_id]));
    const result = await listRowsComplete('followups', queries);
    const ordered = [...result.rows].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
    response.json({ ok: true, data: ordered.map((row) => safeBusinessView(row, request.auth.member)), meta: { requestId: requestId(request), total: ordered.length } });
  } catch (error) { next(error); }
});

router.post('/followups', async (request, response, next) => {
  try {
    const { member } = request.auth; const body = request.body || {}; const companyId = text(body.company_id, 'company_id', 36);
    const company = await requireCompany(companyId);  const timestamp = now();
    let assignedTo = member.user_id;
    if (member.role === 'SUPER_ADMIN' && body.assigned_to_user_id) {
      const result = await listRows('members', [sdk.Query.equal('user_id', [body.assigned_to_user_id]), sdk.Query.equal('is_active', [true])]);
      if (!result.rows[0]) throw new AppError('VALIDATION_ERROR', 'Assigned member must be active.', 400);
      assignedTo = body.assigned_to_user_id;
    }
    const data = {
      company_id: companyId,
      contact_id: await optionalRelated('contacts', text(body.contact_id, 'contact_id', 36), companyId),
      lead_id: await optionalRelated('leads', text(body.lead_id, 'lead_id', 36), companyId),
      opportunity_id: body.opportunity_id ? await optionalRelated('opportunities', text(body.opportunity_id, 'opportunity_id', 36), companyId) : '', related_communication_id: body.related_communication_id ? await getRow('communications', text(body.related_communication_id, 'related_communication_id', 36)).then((event) => { if (event.company_id !== companyId || (body.opportunity_id && event.opportunity_id && event.opportunity_id !== body.opportunity_id)) throw new AppError('VALIDATION_ERROR', 'Related communication must belong to the selected company and opportunity.', 400); return event.$id; }) : '',
      title: text(body.title, 'title', 200), notes: text(body.notes, 'notes', 3000), assigned_to_user_id: assignedTo, due_at: dateValue(body.due_at, 'due_at', true),
      priority: enumValue(body.priority, 'priority', ['LOW', 'NORMAL', 'HIGH'], 'NORMAL'), status: 'PENDING', reminder_at: dateValue(body.reminder_at, 'reminder_at'), completed_at: '',
      owner_member_id: await resolveOwner(member, body.assign_to_member_id), created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id,
    };
    if (!data.title) throw new AppError('VALIDATION_ERROR', 'Follow-up title is required.', 400);
    const row = await adminTables.createRow(databaseId, 'followups', sdk.ID.unique(), data);
    await audit(member, 'CREATE', 'followups', row.$id, null, data, request);
    response.status(201).json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.patch('/followups/:followupId', async (request, response, next) => {
  try {
    const { member } = request.auth; const existing = await getRow('followups', request.params.followupId); const body = request.body || {};
    const allowed = ['title', 'notes', 'due_at', 'reminder_at', 'priority', 'status', 'contact_id', 'lead_id', 'opportunity_id', 'related_communication_id', 'assigned_to_user_id', 'assign_to_member_id'];
    const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const data = { ...existing };
    if (body.title !== undefined) data.title = text(body.title, 'title', 200);
    if (body.notes !== undefined) data.notes = text(body.notes, 'notes', 3000);
    if (body.due_at !== undefined) data.due_at = dateValue(body.due_at, 'due_at', true);
    if (body.reminder_at !== undefined) data.reminder_at = dateValue(body.reminder_at, 'reminder_at');
    if (body.priority !== undefined) data.priority = enumValue(body.priority, 'priority', ['LOW', 'NORMAL', 'HIGH']);
    if (body.status !== undefined) data.status = enumValue(body.status, 'status', FOLLOWUP_STATUSES);
    const followupCompany = await getRow('companies', existing.company_id);
    if (body.contact_id !== undefined) data.contact_id = await optionalRelated('contacts', text(body.contact_id, 'contact_id', 36), followupCompany.$id);
    if (body.lead_id !== undefined) data.lead_id = await optionalRelated('leads', text(body.lead_id, 'lead_id', 36), followupCompany.$id);
    if (body.opportunity_id !== undefined) data.opportunity_id = body.opportunity_id ? await optionalRelated('opportunities', text(body.opportunity_id, 'opportunity_id', 36), followupCompany.$id) : '';
    if (body.related_communication_id !== undefined) { const communicationId = text(body.related_communication_id, 'related_communication_id', 36); if (communicationId) { const communication = await getRow('communications', communicationId); if (communication.company_id !== followupCompany.$id || (data.opportunity_id && communication.opportunity_id && communication.opportunity_id !== data.opportunity_id)) throw new AppError('VALIDATION_ERROR', 'Related communication must belong to the follow-up company and opportunity.', 400); } data.related_communication_id = communicationId; }
    if (body.assigned_to_user_id !== undefined) {
      if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign follow-ups.', 403);
      const result = await listRows('members', [sdk.Query.equal('user_id', [body.assigned_to_user_id]), sdk.Query.equal('is_active', [true])]);
      if (!result.rows[0]) throw new AppError('VALIDATION_ERROR', 'Assigned member must be active.', 400);
      data.assigned_to_user_id = body.assigned_to_user_id;
    }
    if (body.assign_to_member_id !== undefined) { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign follow-up ownership.', 403); data.owner_member_id = await resolveOwner(member, body.assign_to_member_id); }
    data.completed_at = data.status === 'COMPLETED' ? (existing.status === 'COMPLETED' ? existing.completed_at : now()) : '';
    data.updated_at = now(); data.updated_by = member.user_id;
    const row = await adminTables.updateRow(databaseId, 'followups', existing.$id, data);
    await audit(member, body.assign_to_member_id !== undefined ? 'ASSIGN' : data.status !== existing.status ? 'STATUS_CHANGE' : 'UPDATE', 'followups', row.$id, { status: existing.status, due_at: existing.due_at, owner_member_id: existing.owner_member_id }, { status: data.status, due_at: data.due_at, owner_member_id: row.owner_member_id }, request);
    response.json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/opportunities', async (request, response, next) => {
  try {
    const queries = [];
    if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [request.auth.member.user_id]));
    if (request.query.status) queries.push(sdk.Query.equal('opportunity_status', [enumValue(request.query.status, 'status', OPPORTUNITY_STATUSES)]));
    if (request.query.type) queries.push(sdk.Query.equal('opportunity_type', [enumValue(request.query.type, 'type', OPPORTUNITY_TYPES)]));
    if (request.query.company_id) queries.push(sdk.Query.equal('company_id', [request.query.company_id]));
    const result = await listRowsPage('opportunities', queries, request);
    response.json({ ok: true, data: result.rows.map((row) => safeOpportunityView(row, request.auth.member)), meta: { requestId: requestId(request), total: result.total, page: result.page, limit: result.limit, pages: result.pages } });
  } catch (error) { next(error); }
});

router.get('/opportunities/:opportunityId', async (request, response, next) => {
  try {
    const row = await getRow('opportunities', request.params.opportunityId);
    const [applications, confirmations, communications, followups, interviews] = await Promise.all([
      listRowsComplete('applications', [sdk.Query.equal('opportunity_id', [row.$id])]),
      listRowsComplete('academic_confirmations', [sdk.Query.equal('opportunity_id', [row.$id])]),
      listRowsComplete('communications', [sdk.Query.equal('opportunity_id', [row.$id])]),
      listRowsComplete('followups', [sdk.Query.equal('opportunity_id', [row.$id])]),
      listRowsComplete('interviews', [sdk.Query.equal('opportunity_id', [row.$id])]),
    ]);
    response.json({ ok: true, data: { opportunity: safeOpportunityView(row, request.auth.member), related: { applications: applications.rows.map((item) => safeBusinessView(item, request.auth.member)), confirmations: confirmations.rows.map((item) => safeBusinessView(item, request.auth.member)), communications: communications.rows.map((item) => safeBusinessView(item, request.auth.member)), followups: followups.rows.map((item) => safeBusinessView(item, request.auth.member)), interviews: interviews.rows.map((item) => safeBusinessView(item, request.auth.member)) } }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.post('/opportunities', async (request, response, next) => {
  try {
    const { member } = request.auth; const body = request.body || {}; const companyId = text(body.company_id, 'company_id', 36);
    const company = await requireCompany(companyId);  const timestamp = now(); const owner = await resolveOwner(member, body.assign_to_member_id);
    const details = { jd_document_id: '', jd_received_at: dateValue(body.jd_received_at, 'jd_received_at'), form_floated_at: dateValue(body.form_floated_at, 'form_floated_at'), eligible_branches: stringArray(body.eligible_branches, 'eligible_branches'), eligible_years: stringArray(body.eligible_years, 'eligible_years'), qualification: text(body.qualification, 'qualification', 5000), required_skills: stringArray(body.required_skills, 'required_skills'), selection_process: text(body.selection_process, 'selection_process', 5000) };
    const detailsJson = JSON.stringify(details);
    if (detailsJson.length > 2000) throw new AppError('VALIDATION_ERROR', 'Opportunity eligibility and process details exceed the 2,000 character limit.', 400);
    const data = {
      company_id: companyId, title: text(body.title, 'title', 200), opportunity_type: enumValue(body.opportunity_type, 'opportunity_type', OPPORTUNITY_TYPES), role_title: text(body.role_title, 'role_title', 200),
      job_description_text: text(body.job_description_text, 'job_description_text', 10000), details_json: detailsJson,
      location: text(body.location, 'location', 200), work_mode: body.work_mode ? enumValue(body.work_mode, 'work_mode', ['ONSITE', 'HYBRID', 'REMOTE', 'NOT_SPECIFIED']) : '', openings_count: numberValue(body.openings_count, 'openings_count', { integer: true }),
      stipend_amount: numberValue(body.stipend_amount, 'stipend_amount'), salary_min: numberValue(body.salary_min, 'salary_min'), salary_max: numberValue(body.salary_max, 'salary_max'), currency: text(body.currency, 'currency', 8) || 'INR', compensation_notes: text(body.compensation_notes, 'compensation_notes', 1000),
      duration: text(body.duration, 'duration', 120), start_date: dateValue(body.start_date, 'start_date'), application_form_url: url(body.application_form_url, 'application_form_url'), application_deadline: dateValue(body.application_deadline, 'application_deadline'),
      opportunity_status: enumValue(body.opportunity_status, 'opportunity_status', OPPORTUNITY_STATUSES, 'DRAFT'), owner_member_id: owner, created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id, is_archived: false,
    };
    if (!data.title) throw new AppError('VALIDATION_ERROR', 'Opportunity title is required.', 400);
    if (data.salary_min !== null && data.salary_max !== null && data.salary_max < data.salary_min) throw new AppError('VALIDATION_ERROR', 'salary_max must be at least salary_min.', 400);
    const row = await adminTables.createRow(databaseId, 'opportunities', sdk.ID.unique(), data);
    await audit(member, 'CREATE', 'opportunities', row.$id, null, data, request);
    response.status(201).json({ ok: true, data: safeOpportunityView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.patch('/opportunities/:opportunityId', async (request, response, next) => {
  try {
    const { member } = request.auth; const existing = await getRow('opportunities', request.params.opportunityId); const body = request.body || {};
    const detailFields = ['jd_document_id', 'jd_received_at', 'form_floated_at', 'eligible_branches', 'eligible_years', 'qualification', 'required_skills', 'selection_process'];
    const allowed = ['title', 'opportunity_type', 'role_title', 'job_description_text', ...detailFields, 'location', 'work_mode', 'openings_count', 'stipend_amount', 'salary_min', 'salary_max', 'currency', 'compensation_notes', 'duration', 'start_date', 'application_form_url', 'application_deadline', 'opportunity_status', 'is_archived', 'assign_to_member_id'];
    const unknown = Object.keys(body).filter((key) => !allowed.includes(key)); if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const data = { ...existing };
    for (const field of ['title', 'role_title', 'job_description_text', 'location', 'currency', 'compensation_notes', 'duration']) if (body[field] !== undefined) data[field] = text(body[field], field, field === 'job_description_text' ? 10000 : 500);
    if (body.opportunity_type !== undefined) data.opportunity_type = enumValue(body.opportunity_type, 'opportunity_type', OPPORTUNITY_TYPES);
    if (body.opportunity_status !== undefined) data.opportunity_status = enumValue(body.opportunity_status, 'opportunity_status', OPPORTUNITY_STATUSES);
    if (body.work_mode !== undefined) data.work_mode = body.work_mode ? enumValue(body.work_mode, 'work_mode', ['ONSITE', 'HYBRID', 'REMOTE', 'NOT_SPECIFIED']) : '';
    if (body.application_form_url !== undefined) data.application_form_url = url(body.application_form_url, 'application_form_url');
    for (const field of ['start_date', 'application_deadline']) if (body[field] !== undefined) data[field] = dateValue(body[field], field);
    for (const field of ['openings_count', 'stipend_amount', 'salary_min', 'salary_max']) if (body[field] !== undefined) data[field] = numberValue(body[field], field, { integer: field === 'openings_count' });
    const details = existing.details_json ? JSON.parse(existing.details_json) : {};
    for (const field of detailFields) if (body[field] !== undefined) details[field] = field === 'jd_document_id' ? await validateDocumentReference(text(body[field], field, 36), 'OPPORTUNITY', existing.$id, 'job description') : ['eligible_branches', 'eligible_years', 'required_skills'].includes(field) ? stringArray(body[field], field) : field.endsWith('_at') ? dateValue(body[field], field) : field === 'qualification' || field === 'selection_process' ? text(body[field], field, 5000) : text(body[field], field, 36);
    if (detailFields.some((field) => body[field] !== undefined)) { data.details_json = JSON.stringify(details); if (data.details_json.length > 2000) throw new AppError('VALIDATION_ERROR', 'Opportunity eligibility and process details exceed the 2,000 character limit.', 400); }
    if (body.is_archived !== undefined) { if (typeof body.is_archived !== 'boolean') throw new AppError('VALIDATION_ERROR', 'is_archived must be true or false.', 400); data.is_archived = body.is_archived; }
    if (body.assign_to_member_id !== undefined) { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign opportunity ownership.', 403); data.owner_member_id = await resolveOwner(member, body.assign_to_member_id); }
    if (data.salary_min !== null && data.salary_max !== null && data.salary_max < data.salary_min) throw new AppError('VALIDATION_ERROR', 'salary_max must be at least salary_min.', 400);
    data.updated_at = now(); data.updated_by = member.user_id;
    const row = await adminTables.updateRow(databaseId, 'opportunities', existing.$id, data);
    await audit(member, body.assign_to_member_id !== undefined ? 'ASSIGN' : 'UPDATE', 'opportunities', row.$id, { opportunity_status: existing.opportunity_status, owner_member_id: existing.owner_member_id }, { opportunity_status: data.opportunity_status, owner_member_id: row.owner_member_id }, request);
    response.json({ ok: true, data: safeOpportunityView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/academic-confirmations', async (request, response, next) => {
  try { const queries = []; if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [request.auth.member.user_id])); if (request.query.opportunity_id) queries.push(sdk.Query.equal('opportunity_id', [request.query.opportunity_id])); if (request.query.status) queries.push(sdk.Query.equal('status', [enumValue(request.query.status, 'status', ['PENDING', 'CONFIRMED', 'DECLINED', 'CONDITIONAL', 'ACKNOWLEDGED', 'NOT_REQUIRED'])])); const result = await listRowsComplete('academic_confirmations', queries); response.json({ ok: true, data: result.rows.map((row) => safeBusinessView(row, request.auth.member)), meta: { requestId: requestId(request), total: result.rows.length } }); } catch (error) { next(error); }
});

router.post('/academic-confirmations', async (request, response, next) => {
  try {
    const { member } = request.auth; const body = request.body || {}; const opportunity = await getRow('opportunities', text(body.opportunity_id, 'opportunity_id', 36));  const timestamp = now();
    if (body.contact_id) await optionalRelated('contacts', text(body.contact_id, 'contact_id', 36), opportunity.company_id);
    if (body.communication_id) { const event = await getRow('communications', text(body.communication_id, 'communication_id', 36)); if (event.company_id !== opportunity.company_id || (event.opportunity_id && event.opportunity_id !== opportunity.$id)) throw new AppError('VALIDATION_ERROR', 'Evidence communication must belong to the opportunity.', 400); }
    const documentId = text(body.document_id, 'document_id', 36); if (documentId) { const document = await getRow('documents', documentId); const entity = await getDocumentEntity(document.related_entity_type, document.related_entity_id); const relatedOpportunity = document.related_entity_type === 'OPPORTUNITY' ? entity : entity.opportunity_id ? await getRow('opportunities', entity.opportunity_id) : null; if (document.is_archived || !['COMPANY', 'OPPORTUNITY', 'APPLICATION'].includes(document.related_entity_type) || (document.related_entity_type === 'COMPANY' && entity.$id !== opportunity.company_id) || (relatedOpportunity && (relatedOpportunity.$id !== opportunity.$id || relatedOpportunity.company_id !== opportunity.company_id))) throw new AppError('VALIDATION_ERROR', 'Confirmation evidence must be an active document for this opportunity or company.', 400); }
    const data = { opportunity_id: opportunity.$id, company_id: opportunity.company_id, confirmation_type: enumValue(body.confirmation_type, 'confirmation_type', ['EXAM_LEAVE', 'JOINING_DATE', 'NOC', 'UNIVERSITY_REPLY', 'COMPANY_ACKNOWLEDGEMENT', 'OTHER']), requested_from: enumValue(body.requested_from, 'requested_from', ['COMPANY', 'UNIVERSITY', 'STUDENT', 'OTHER']), status: enumValue(body.status, 'status', ['PENDING', 'CONFIRMED', 'DECLINED', 'CONDITIONAL', 'ACKNOWLEDGED', 'NOT_REQUIRED']), academic_year: text(body.academic_year, 'academic_year', 16), joining_date: dateValue(body.joining_date, 'joining_date'), exam_period_start: dateValue(body.exam_period_start, 'exam_period_start'), exam_period_end: dateValue(body.exam_period_end, 'exam_period_end'), confirmation_text: text(body.confirmation_text, 'confirmation_text', 5000), contact_id: text(body.contact_id, 'contact_id', 36), communication_id: text(body.communication_id, 'communication_id', 36), document_id: documentId, confirmed_at: dateValue(body.confirmed_at, 'confirmed_at'), owner_member_id: await resolveOwner(member, body.assign_to_member_id), created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id };
    if (data.exam_period_start && data.exam_period_end && data.exam_period_end < data.exam_period_start) throw new AppError('VALIDATION_ERROR', 'Exam period end must be after its start.', 400);
    const row = await adminTables.createRow(databaseId, 'academic_confirmations', sdk.ID.unique(), data); await audit(member, 'CREATE', 'academic_confirmations', row.$id, null, data, request); response.status(201).json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.patch('/academic-confirmations/:confirmationId', async (request, response, next) => {
  try {
    const { member } = request.auth; const existing = await getRow('academic_confirmations', request.params.confirmationId); const body = request.body || {};
    const allowed = ['confirmation_type', 'requested_from', 'status', 'academic_year', 'joining_date', 'exam_period_start', 'exam_period_end', 'confirmation_text', 'contact_id', 'communication_id', 'document_id', 'confirmed_at', 'assign_to_member_id'];
    const unknown = Object.keys(body).filter((key) => !allowed.includes(key)); if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const data = { ...existing };
    if (body.confirmation_type !== undefined) data.confirmation_type = enumValue(body.confirmation_type, 'confirmation_type', ['EXAM_LEAVE', 'JOINING_DATE', 'NOC', 'UNIVERSITY_REPLY', 'COMPANY_ACKNOWLEDGEMENT', 'OTHER']);
    if (body.requested_from !== undefined) data.requested_from = enumValue(body.requested_from, 'requested_from', ['COMPANY', 'UNIVERSITY', 'STUDENT', 'OTHER']);
    if (body.status !== undefined) data.status = enumValue(body.status, 'status', ['PENDING', 'CONFIRMED', 'DECLINED', 'CONDITIONAL', 'ACKNOWLEDGED', 'NOT_REQUIRED']);
    if (body.academic_year !== undefined) data.academic_year = text(body.academic_year, 'academic_year', 16);
    if (body.confirmation_text !== undefined) data.confirmation_text = text(body.confirmation_text, 'confirmation_text', 5000);
    for (const field of ['joining_date', 'exam_period_start', 'exam_period_end', 'confirmed_at']) if (body[field] !== undefined) data[field] = dateValue(body[field], field);
    if (body.contact_id !== undefined) { if (body.contact_id) await optionalRelated('contacts', body.contact_id, existing.company_id); data.contact_id = text(body.contact_id, 'contact_id', 36); }
    if (body.communication_id !== undefined) { if (body.communication_id) { const event = await getRow('communications', body.communication_id); if (event.company_id !== existing.company_id || (event.opportunity_id && event.opportunity_id !== existing.opportunity_id)) throw new AppError('VALIDATION_ERROR', 'Evidence communication must belong to the confirmation opportunity.', 400); } data.communication_id = text(body.communication_id, 'communication_id', 36); }
    if (body.document_id !== undefined) { const documentId = text(body.document_id, 'document_id', 36); if (documentId) { const document = await getRow('documents', documentId); const entity = await getDocumentEntity(document.related_entity_type, document.related_entity_id); const relatedOpportunity = document.related_entity_type === 'OPPORTUNITY' ? entity : entity.opportunity_id ? await getRow('opportunities', entity.opportunity_id) : null; if (document.is_archived || !['COMPANY', 'OPPORTUNITY', 'APPLICATION'].includes(document.related_entity_type) || (document.related_entity_type === 'COMPANY' && entity.$id !== existing.company_id) || (relatedOpportunity && relatedOpportunity.$id !== existing.opportunity_id)) throw new AppError('VALIDATION_ERROR', 'Confirmation evidence must be an active document for this opportunity or company.', 400); } data.document_id = documentId; }
    if (body.assign_to_member_id !== undefined) { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign ownership.', 403); data.owner_member_id = await resolveOwner(member, body.assign_to_member_id); }
    if (data.exam_period_start && data.exam_period_end && data.exam_period_end < data.exam_period_start) throw new AppError('VALIDATION_ERROR', 'Exam period end must be after its start.', 400);
    data.updated_at = now(); data.updated_by = member.user_id;
    const row = await adminTables.updateRow(databaseId, 'academic_confirmations', existing.$id, data); await audit(member, body.assign_to_member_id !== undefined ? 'ASSIGN' : 'UPDATE', 'academic_confirmations', row.$id, { status: existing.status, owner_member_id: existing.owner_member_id }, { status: data.status, owner_member_id: row.owner_member_id }, request); response.json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/students', async (request, response, next) => {
  try { const queries = []; if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [request.auth.member.user_id])); const result = await listRowsComplete('students', queries); response.json({ ok: true, data: result.rows.map((row) => safeBusinessView(row, request.auth.member)), meta: { requestId: requestId(request), total: result.rows.length } }); } catch (error) { next(error); }
});

router.post('/students', async (request, response, next) => {
  try {
    const { member } = request.auth; const body = request.body || {}; const name = text(body.full_name, 'full_name', 160); if (!name) throw new AppError('VALIDATION_ERROR', 'Student name is required.', 400);
    const roll = text(body.university_roll_number, 'university_roll_number', 64);
    if (roll) { const duplicate = await listRows('students', [sdk.Query.equal('university_roll_number', [roll])]); if (duplicate.rows.length) throw new AppError('CONFLICT', 'A student with this roll number already exists.', 409); }
    const timestamp = now(); const data = { full_name: name, university_roll_number: roll, university_email: email(body.university_email, 'university_email'), personal_email: email(body.personal_email, 'personal_email'), phone: text(body.phone, 'phone', 40), college_name: text(body.college_name, 'college_name', 200), campus_type: body.campus_type ? enumValue(body.campus_type, 'campus_type', ['CAMPUS', 'AFFILIATED', 'OTHER']) : '', branch: text(body.branch, 'branch', 120), program: text(body.program, 'program', 120), semester: text(body.semester, 'semester', 40), graduation_batch: text(body.graduation_batch, 'graduation_batch', 32), cgpa_or_percentage: text(body.cgpa_or_percentage, 'cgpa_or_percentage', 40), backlog_count: numberValue(body.backlog_count, 'backlog_count', { integer: true }), eligibility_notes: text(body.eligibility_notes, 'eligibility_notes', 3000), owner_member_id: await resolveOwner(member, body.assign_to_member_id), created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id, is_archived: false };
    const row = await adminTables.createRow(databaseId, 'students', sdk.ID.unique(), data); await audit(member, 'CREATE', 'students', row.$id, null, { ...data, personal_email: data.personal_email ? '[stored]' : '' }, request); response.status(201).json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/students/:studentId', async (request, response, next) => {
  try { const row = await getRow('students', request.params.studentId);  response.json({ ok: true, data: safeBusinessView(row, request.auth.member), meta: { requestId: requestId(request) } }); } catch (error) { next(error); }
});

router.patch('/students/:studentId', async (request, response, next) => {
  try {
    const { member } = request.auth; const existing = await getRow('students', request.params.studentId); const body = request.body || {};
    const allowed = ['full_name', 'university_roll_number', 'university_email', 'personal_email', 'phone', 'college_name', 'campus_type', 'branch', 'program', 'semester', 'graduation_batch', 'cgpa_or_percentage', 'backlog_count', 'eligibility_notes', 'is_archived', 'assign_to_member_id'];
    const unknown = Object.keys(body).filter((key) => !allowed.includes(key)); if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const data = { ...existing };
    for (const field of ['full_name', 'university_roll_number', 'phone', 'college_name', 'branch', 'program', 'semester', 'graduation_batch', 'cgpa_or_percentage', 'eligibility_notes']) if (body[field] !== undefined) data[field] = text(body[field], field, field === 'eligibility_notes' ? 3000 : field === 'full_name' ? 160 : 200);
    for (const field of ['university_email', 'personal_email']) if (body[field] !== undefined) data[field] = email(body[field], field);
    if (body.campus_type !== undefined) data.campus_type = body.campus_type ? enumValue(body.campus_type, 'campus_type', ['CAMPUS', 'AFFILIATED', 'OTHER']) : '';
    if (body.backlog_count !== undefined) data.backlog_count = numberValue(body.backlog_count, 'backlog_count', { integer: true });
    if (body.is_archived !== undefined) { if (typeof body.is_archived !== 'boolean') throw new AppError('VALIDATION_ERROR', 'is_archived must be true or false.', 400); data.is_archived = body.is_archived; }
    if (body.assign_to_member_id !== undefined) { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign ownership.', 403); data.owner_member_id = await resolveOwner(member, body.assign_to_member_id); }
    if (!data.full_name) throw new AppError('VALIDATION_ERROR', 'Student name is required.', 400);
    const roll = data.university_roll_number;
    if (roll && roll !== existing.university_roll_number) { const duplicates = await listRows('students', [sdk.Query.equal('university_roll_number', [roll])]); if (duplicates.rows.some((row) => row.$id !== existing.$id)) throw new AppError('CONFLICT', 'A student with this roll number already exists.', 409); }
    data.updated_at = now(); data.updated_by = member.user_id;
    const row = await adminTables.updateRow(databaseId, 'students', existing.$id, data); await audit(member, body.assign_to_member_id !== undefined ? 'ASSIGN' : 'UPDATE', 'students', row.$id, { full_name: existing.full_name, owner_member_id: existing.owner_member_id }, { full_name: row.full_name, owner_member_id: row.owner_member_id }, request); response.json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/applications', async (request, response, next) => {
  try { const queries = []; if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [request.auth.member.user_id])); if (request.query.opportunity_id) queries.push(sdk.Query.equal('opportunity_id', [request.query.opportunity_id])); if (request.query.student_id) queries.push(sdk.Query.equal('student_id', [request.query.student_id])); const result = await listRowsComplete('applications', queries); response.json({ ok: true, data: result.rows.map((row) => safeBusinessView(row, request.auth.member)), meta: { requestId: requestId(request), total: result.rows.length } }); } catch (error) { next(error); }
});

router.post('/applications', async (request, response, next) => {
  try {
    const { member } = request.auth; const body = request.body || {}; const opportunity = await getRow('opportunities', text(body.opportunity_id, 'opportunity_id', 36)); const student = await getRow('students', text(body.student_id, 'student_id', 36));
    const duplicate = await listRows('applications', [sdk.Query.equal('opportunity_id', [opportunity.$id]), sdk.Query.equal('student_id', [body.student_id])]); if (duplicate.rows.length) throw new AppError('CONFLICT', 'This student already has an application for the opportunity.', 409);
    const timestamp = now(); const data = { opportunity_id: opportunity.$id, student_id: student.$id, applied_at: dateValue(body.applied_at, 'applied_at'), application_source: enumValue(body.application_source, 'application_source', ['FORM', 'MANUAL', 'IMPORT', 'OTHER']), form_reference: text(body.form_reference, 'form_reference', 200), application_status: enumValue(body.application_status, 'application_status', ['APPLIED', 'SHORTLISTED', 'NOT_ELIGIBLE', 'WITHDRAWN', 'REJECTED', 'SELECTED', 'WAITLISTED'], 'APPLIED'), notes: text(body.notes, 'notes', 3000), owner_member_id: await resolveOwner(member, body.assign_to_member_id), created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id };
    const row = await adminTables.createRow(databaseId, 'applications', sdk.ID.unique(), data); await audit(member, 'CREATE', 'applications', row.$id, null, data, request); response.status(201).json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/applications/:applicationId', async (request, response, next) => {
  try { const row = await getRow('applications', request.params.applicationId);  response.json({ ok: true, data: safeBusinessView(row, request.auth.member), meta: { requestId: requestId(request) } }); } catch (error) { next(error); }
});

router.patch('/applications/:applicationId', async (request, response, next) => {
  try {
    const { member } = request.auth; const existing = await getRow('applications', request.params.applicationId); const body = request.body || {};
    const allowed = ['applied_at', 'application_source', 'form_reference', 'application_status', 'notes', 'assign_to_member_id']; const unknown = Object.keys(body).filter((key) => !allowed.includes(key)); if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const data = { ...existing };
    if (body.applied_at !== undefined) data.applied_at = dateValue(body.applied_at, 'applied_at');
    if (body.application_source !== undefined) data.application_source = enumValue(body.application_source, 'application_source', ['FORM', 'MANUAL', 'IMPORT', 'OTHER']);
    if (body.form_reference !== undefined) data.form_reference = text(body.form_reference, 'form_reference', 200);
    if (body.application_status !== undefined) data.application_status = enumValue(body.application_status, 'application_status', ['APPLIED', 'SHORTLISTED', 'NOT_ELIGIBLE', 'WITHDRAWN', 'REJECTED', 'SELECTED', 'WAITLISTED']);
    if (body.notes !== undefined) data.notes = text(body.notes, 'notes', 3000);
    if (body.assign_to_member_id !== undefined) { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign ownership.', 403); data.owner_member_id = await resolveOwner(member, body.assign_to_member_id); }
    data.updated_at = now(); data.updated_by = member.user_id;
    const row = await adminTables.updateRow(databaseId, 'applications', existing.$id, data); await audit(member, body.assign_to_member_id !== undefined ? 'ASSIGN' : 'UPDATE', 'applications', row.$id, { application_status: existing.application_status, owner_member_id: existing.owner_member_id }, { application_status: data.application_status, owner_member_id: row.owner_member_id }, request); response.json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/interviews', async (request, response, next) => {
  try { const queries = []; if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [request.auth.member.user_id])); if (request.query.application_id) queries.push(sdk.Query.equal('application_id', [request.query.application_id])); if (request.query.opportunity_id) queries.push(sdk.Query.equal('opportunity_id', [request.query.opportunity_id])); const result = await listRowsComplete('interviews', queries); response.json({ ok: true, data: result.rows.map((row) => safeBusinessView(row, request.auth.member)), meta: { requestId: requestId(request), total: result.rows.length } }); } catch (error) { next(error); }
});

router.get('/resume-shares', async (request, response, next) => {
  try {
    const queries = []; if (request.query.scope === 'mine') queries.push(sdk.Query.equal('owner_member_id', [request.auth.member.user_id])); if (request.query.opportunity_id) queries.push(sdk.Query.equal('opportunity_id', [text(request.query.opportunity_id, 'opportunity_id', 36)])); if (request.query.student_id) queries.push(sdk.Query.equal('student_id', [text(request.query.student_id, 'student_id', 36)]));
    const result = await listRowsComplete('resume_shares', queries); response.json({ ok: true, data: result.rows.map((row) => safeBusinessView(row, request.auth.member)), meta: { requestId: requestId(request), total: result.rows.length } });
  } catch (error) { next(error); }
});

router.post('/resume-shares', async (request, response, next) => {
  try {
    const { member } = request.auth; const body = request.body || {}; const opportunity = await getDocumentEntity('OPPORTUNITY', text(body.opportunity_id, 'opportunity_id', 36)); const student = await getDocumentEntity('STUDENT', text(body.student_id, 'student_id', 36));  const timestamp = now();
    const contactId = text(body.shared_with_contact_id, 'shared_with_contact_id', 36); if (contactId) await optionalRelated('contacts', contactId, opportunity.company_id);
    const communicationId = text(body.communication_id, 'communication_id', 36); if (communicationId) { const communication = await getRow('communications', communicationId); if (communication.company_id !== opportunity.company_id || (communication.opportunity_id && communication.opportunity_id !== opportunity.$id)) throw new AppError('VALIDATION_ERROR', 'The communication reference must belong to this opportunity company.', 400);  }
    const data = { opportunity_id: opportunity.$id, student_id: student.$id, shared_with_contact_id: contactId, communication_id: communicationId, shared_at: dateValue(body.shared_at, 'shared_at') || timestamp, shared_by: member.user_id, channel: enumValue(body.channel, 'channel', ['EMAIL', 'LINKEDIN', 'PHONE', 'OTHER']), batch_id: text(body.batch_id, 'batch_id', 36), notes: text(body.notes, 'notes', 2000), owner_member_id: await resolveOwner(member, body.assign_to_member_id), created_at: timestamp };
    const row = await adminTables.createRow(databaseId, 'resume_shares', sdk.ID.unique(), data); await audit(member, 'CREATE', 'resume_shares', row.$id, null, data, request); response.status(201).json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.post('/interviews', async (request, response, next) => {
  try {
    const { member } = request.auth; const body = request.body || {}; const application = await getRow('applications', text(body.application_id, 'application_id', 36));
    const opportunityId = text(body.opportunity_id, 'opportunity_id', 36); const opportunity = await getRow('opportunities', opportunityId);  if (application.opportunity_id !== opportunityId) throw new AppError('VALIDATION_ERROR', 'Interview opportunity must match the application.', 400);
    const roundNumber = numberValue(body.round_number, 'round_number', { integer: true, min: 1 }); const timestamp = now();
    if (roundNumber === null) throw new AppError('VALIDATION_ERROR', 'round_number is required.', 400);
    const interviewerId = text(body.interviewer_contact_id, 'interviewer_contact_id', 36); if (interviewerId) await optionalRelated('contacts', interviewerId, opportunity.company_id);
    const data = { application_id: application.$id, opportunity_id: opportunityId, round_number: roundNumber, round_name: enumValue(body.round_name, 'round_name', ['APTITUDE', 'TECHNICAL', 'HR', 'MANAGERIAL', 'OTHER']), scheduled_at: dateValue(body.scheduled_at, 'scheduled_at'), mode: body.mode ? enumValue(body.mode, 'mode', ['ONLINE', 'OFFLINE', 'PHONE', 'OTHER']) : '', venue_or_meeting_details: text(body.venue_or_meeting_details, 'venue_or_meeting_details', 1000), interviewer_contact_id: interviewerId, attendance_status: enumValue(body.attendance_status, 'attendance_status', ['SCHEDULED', 'ATTENDED', 'NO_SHOW', 'RESCHEDULED', 'CANCELLED'], 'SCHEDULED'), result: enumValue(body.result, 'result', ['PENDING', 'SELECTED_NEXT_ROUND', 'SELECTED', 'REJECTED', 'ON_HOLD'], 'PENDING'), feedback: text(body.feedback, 'feedback', 5000), result_received_at: dateValue(body.result_received_at, 'result_received_at'), owner_member_id: await resolveOwner(member, body.assign_to_member_id), created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id };
    const row = await adminTables.createRow(databaseId, 'interviews', sdk.ID.unique(), data); await audit(member, 'CREATE', 'interviews', row.$id, null, data, request); response.status(201).json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.patch('/interviews/:interviewId', async (request, response, next) => {
  try {
    const { member } = request.auth; const existing = await getRow('interviews', request.params.interviewId); const body = request.body || {};
    const allowed = ['round_number', 'round_name', 'scheduled_at', 'mode', 'venue_or_meeting_details', 'interviewer_contact_id', 'attendance_status', 'result', 'feedback', 'result_received_at', 'assign_to_member_id']; const unknown = Object.keys(body).filter((key) => !allowed.includes(key)); if (unknown.length) throw new AppError('VALIDATION_ERROR', `Unsupported fields: ${unknown.join(', ')}.`, 400);
    const data = { ...existing };
    if (body.round_number !== undefined) data.round_number = numberValue(body.round_number, 'round_number', { integer: true, min: 1 });
    if (body.round_name !== undefined) data.round_name = enumValue(body.round_name, 'round_name', ['APTITUDE', 'TECHNICAL', 'HR', 'MANAGERIAL', 'OTHER']);
    if (body.scheduled_at !== undefined) data.scheduled_at = dateValue(body.scheduled_at, 'scheduled_at');
    if (body.mode !== undefined) data.mode = body.mode ? enumValue(body.mode, 'mode', ['ONLINE', 'OFFLINE', 'PHONE', 'OTHER']) : '';
    if (body.venue_or_meeting_details !== undefined) data.venue_or_meeting_details = text(body.venue_or_meeting_details, 'venue_or_meeting_details', 1000);
    if (body.interviewer_contact_id !== undefined) data.interviewer_contact_id = text(body.interviewer_contact_id, 'interviewer_contact_id', 36);
    if (data.interviewer_contact_id) { const opportunity = await getRow('opportunities', existing.opportunity_id); await optionalRelated('contacts', data.interviewer_contact_id, opportunity.company_id); }
    if (body.attendance_status !== undefined) data.attendance_status = enumValue(body.attendance_status, 'attendance_status', ['SCHEDULED', 'ATTENDED', 'NO_SHOW', 'RESCHEDULED', 'CANCELLED']);
    if (body.result !== undefined) data.result = enumValue(body.result, 'result', ['PENDING', 'SELECTED_NEXT_ROUND', 'SELECTED', 'REJECTED', 'ON_HOLD']);
    if (body.feedback !== undefined) data.feedback = text(body.feedback, 'feedback', 5000);
    if (body.result_received_at !== undefined) data.result_received_at = dateValue(body.result_received_at, 'result_received_at');
    if (body.assign_to_member_id !== undefined) { if (member.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only TPO can reassign ownership.', 403); data.owner_member_id = await resolveOwner(member, body.assign_to_member_id); }
    data.updated_at = now(); data.updated_by = member.user_id;
    const row = await adminTables.updateRow(databaseId, 'interviews', existing.$id, data); await audit(member, body.assign_to_member_id !== undefined ? 'ASSIGN' : 'UPDATE', 'interviews', row.$id, { attendance_status: existing.attendance_status, result: existing.result, owner_member_id: existing.owner_member_id }, { attendance_status: data.attendance_status, result: data.result, owner_member_id: row.owner_member_id }, request); response.json({ ok: true, data: safeBusinessView(row, member), meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.post('/imports/preview', async (request, response, next) => {
  try {
    const { member } = request.auth; const grid = request.body?.grid;
    if (typeof grid !== 'string' || !grid.trim()) throw new AppError('VALIDATION_ERROR', 'Paste spreadsheet rows first.', 400);
    if (Buffer.byteLength(grid, 'utf8') > 250000) throw new AppError('PAYLOAD_TOO_LARGE', 'Paste is larger than 250 KB.', 413);
    const lines = grid.replace(/\r/g, '').split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length > 250) throw new AppError('VALIDATION_ERROR', 'A paste can contain at most 250 rows.', 400);
    const matrix = lines.map((line) => line.split('\t').map((cell) => cell.trim()));
    const maxColumns = Math.max(...matrix.map((row) => row.length));
    if (maxColumns > 30) throw new AppError('VALIDATION_ERROR', 'A paste can contain at most 30 columns.', 400);
    if (matrix.some((row) => row.some((cell) => cell.length > 2000))) throw new AppError('VALIDATION_ERROR', 'Each cell must be 2,000 characters or fewer.', 400);
    const aliasLookup = new Map(Object.entries(IMPORT_HEADER_ALIASES).flatMap(([field, aliases]) => aliases.map((alias) => [headerKey(alias), field])));
    const firstHeaderMap = new Map(matrix[0].map((header, index) => [aliasLookup.get(headerKey(header)), index]).filter(([field]) => field));
    const hasHeader = request.body.has_header === undefined ? firstHeaderMap.has('company_name') : Boolean(request.body.has_header);
    const providedMapping = request.body.mapping && typeof request.body.mapping === 'object' ? request.body.mapping : null;
    const mapping = providedMapping || (hasHeader ? Object.fromEntries(firstHeaderMap) : { company_name: 0, contact_name: 1, work_email: 2, phone: 3, location: 4, branches: 5, industry: 6, website: 7, lead_notes: 8 });
    if (mapping.company_name === undefined) throw new AppError('VALIDATION_ERROR', 'Map a column to Company Name before preview.', 400);
    const dataRows = (hasHeader ? matrix.slice(1) : matrix).map((cells, index) => ({ cells, rowNumber: index + (hasHeader ? 2 : 1) })).filter(({ cells }) => cells.some((cell) => cell));
    if (!dataRows.length) throw new AppError('VALIDATION_ERROR', 'Paste at least one data row below the header.', 400);
    if (dataRows.some(({ cells }) => JSON.stringify(cells).length > 4000)) throw new AppError('VALIDATION_ERROR', 'A row exceeds the 4,000 character preview limit. Split the paste into smaller rows.', 400);
    const seenInPaste = new Map(); const previews = [];
    for (let index = 0; index < dataRows.length; index += 1) {
      const { cells, rowNumber } = dataRows[index]; const mapped = {};
      for (const [field, columnIndex] of Object.entries(mapping)) if (['company_name', 'contact_name', 'work_email', 'phone', 'location', 'branches', 'industry', 'website', 'lead_notes'].includes(field) && Number.isInteger(Number(columnIndex))) mapped[field] = text(cells[Number(columnIndex)] || '', field, 2000);
      mapped.company_name = text(mapped.company_name, 'company_name', 200);
      mapped.normalized_name = normalizedName(mapped.company_name);
      if (mapped.work_email) mapped.work_email = mapped.work_email.toLowerCase();
      const errors = []; const warnings = [];
      if (!mapped.company_name) errors.push('Company name is required.');
      if (mapped.work_email && !/^\S+@\S+\.\S+$/.test(mapped.work_email)) warnings.push('Email format looks invalid; review before saving.');
      if (mapped.website && !/^https?:\/\//i.test(mapped.website)) warnings.push('Website must start with http:// or https://; it will not be saved as a URL.');
      if (mapping.assigned_label !== undefined && cells[Number(mapping.assigned_label)]) warnings.push('Assigned member text is ignored; ownership is set to the signed-in user.');
      const previousRow = seenInPaste.get(mapped.normalized_name);
      if (mapped.normalized_name) seenInPaste.set(mapped.normalized_name, previousRow || rowNumber);
      let duplicateCompanyId = '';
      if (mapped.normalized_name) {
        const matching = await listRows('companies', [sdk.Query.equal('normalized_name', [mapped.normalized_name])]);
        duplicateCompanyId = matching.rows[0]?.$id || '';
      }
      if (duplicateCompanyId) warnings.push('A matching company already exists. Choose whether to reuse it or create a separate record.');
      if (previousRow && previousRow !== rowNumber) warnings.push(`Same company also appears on pasted row ${previousRow}; rows will share one company if committed together.`);
      const status = errors.length ? 'INVALID' : duplicateCompanyId ? 'DUPLICATE_CANDIDATE' : warnings.length ? 'WARNING' : 'VALID';
      const mappedJson = JSON.stringify(mapped);
      if (mappedJson.length > 4000) throw new AppError('VALIDATION_ERROR', `Mapped data for pasted row ${rowNumber} exceeds the preview storage limit.`, 400);
      previews.push({ row_number: rowNumber, raw_row: JSON.stringify(cells.filter((_, columnIndex) => mapping.assigned_label === undefined || Number(mapping.assigned_label) !== columnIndex)), mapped_row: mappedJson, validation_status: status, validation_errors: errors, validation_warnings: warnings, duplicate_company_id: duplicateCompanyId, duplicate_contact_id: '', save_status: 'NOT_SAVED', created_company_id: '', created_contact_ids: [], created_lead_id: '', error_message: '' });
    }
    const timestamp = now(); const counts = { valid: previews.filter((row) => row.validation_status === 'VALID').length, warnings: previews.filter((row) => ['WARNING', 'DUPLICATE_CANDIDATE'].includes(row.validation_status)).length, invalid: previews.filter((row) => row.validation_status === 'INVALID').length };
    const batch = await adminTables.createRow(databaseId, 'import_batches', sdk.ID.unique(), { batch_name: text(request.body.batch_name, 'batch_name', 200), source_type: 'PASTE_GRID', source_filename: '', started_at: timestamp, completed_at: '', status: 'PREVIEW', total_rows: previews.length, valid_rows: counts.valid, warning_rows: counts.warnings, invalid_rows: counts.invalid, created_records: 0, skipped_records: 0, error_summary: '', created_by: member.user_id, created_at: timestamp, updated_at: timestamp });
    const savedRows = [];
    for (const preview of previews) savedRows.push(await adminTables.createRow(databaseId, 'import_batch_rows', sdk.ID.unique(), { batch_id: batch.$id, ...preview, created_at: timestamp }));
    response.status(201).json({ ok: true, data: { batchId: batch.$id, status: batch.status, summary: { total: previews.length, ...counts }, rows: savedRows.map((row) => ({ id: row.$id, rowNumber: row.row_number, mapped: JSON.parse(row.mapped_row), status: row.validation_status, errors: row.validation_errors, warnings: row.validation_warnings, duplicateCompanyId: row.duplicate_company_id })) }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.get('/imports/:batchId', async (request, response, next) => {
  try {
    const { member } = request.auth; const batch = await getRow('import_batches', request.params.batchId);
    if (member.role !== 'SUPER_ADMIN' && batch.created_by !== member.user_id) throw new AppError('FORBIDDEN', 'You can only view import batches you created.', 403);
    const result = await listRowsComplete('import_batch_rows', [sdk.Query.equal('batch_id', [batch.$id])]);
    response.json({ ok: true, data: { batch: { id: batch.$id, status: batch.status, totalRows: batch.total_rows, validRows: batch.valid_rows, warningRows: batch.warning_rows, invalidRows: batch.invalid_rows, createdRecords: batch.created_records, skippedRecords: batch.skipped_records }, rows: result.rows.map((row) => ({ id: row.$id, rowNumber: row.row_number, mapped: JSON.parse(row.mapped_row || '{}'), status: row.validation_status, errors: row.validation_errors || [], warnings: row.validation_warnings || [], duplicateCompanyId: row.duplicate_company_id, saveStatus: row.save_status, error: row.error_message })) }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.patch('/imports/:batchId/rows/:rowId', async (request, response, next) => {
  try {
    const { member } = request.auth; const batch = await getRow('import_batches', request.params.batchId);
    if (member.role !== 'SUPER_ADMIN' && batch.created_by !== member.user_id) throw new AppError('FORBIDDEN', 'You can only edit import batches you created.', 403);
    if (batch.status !== 'PREVIEW') throw new AppError('CONFLICT', 'Only preview rows can be edited.', 409);
    const existing = await getRow('import_batch_rows', request.params.rowId);
    if (existing.batch_id !== batch.$id || existing.save_status !== 'NOT_SAVED') throw new AppError('NOT_FOUND', 'Preview row was not found in this editable batch.', 404);
    const allowed = ['company_name', 'contact_name', 'work_email', 'phone', 'location', 'branches', 'industry', 'website', 'lead_notes'];
    const input = request.body?.mapped;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((field) => !allowed.includes(field))) throw new AppError('VALIDATION_ERROR', 'Mapped row contains unsupported fields.', 400);
    const mapped = {};
    for (const field of allowed) mapped[field] = text(input[field], field, field === 'company_name' ? 200 : 2000);
    mapped.work_email = mapped.work_email.toLowerCase(); mapped.normalized_name = normalizedName(mapped.company_name);
    const errors = []; const warnings = [];
    if (!mapped.company_name) errors.push('Company name is required.');
    if (mapped.work_email && !/^\S+@\S+\.\S+$/.test(mapped.work_email)) warnings.push('Email format looks invalid; review before saving.');
    if (mapped.website && !/^https?:\/\//i.test(mapped.website)) warnings.push('Website must start with http:// or https://; it will not be saved as a URL.');
    let duplicateCompanyId = '';
    if (mapped.normalized_name) { const matches = await listRows('companies', [sdk.Query.equal('normalized_name', [mapped.normalized_name])]); duplicateCompanyId = matches.rows[0]?.$id || ''; }
    if (duplicateCompanyId) warnings.push('A matching company already exists. Choose whether to reuse it or create a separate record.');
    const duplicatesInBatch = await listRowsComplete('import_batch_rows', [sdk.Query.equal('batch_id', [batch.$id])], 300);
    const groupedDuplicate = duplicatesInBatch.rows.find((row) => row.$id !== existing.$id && row.save_status === 'NOT_SAVED' && JSON.parse(row.mapped_row || '{}').normalized_name === mapped.normalized_name);
    if (groupedDuplicate) warnings.push(`Same company also appears on pasted row ${groupedDuplicate.row_number}; rows will share one company if committed together.`);
    const status = errors.length ? 'INVALID' : duplicateCompanyId ? 'DUPLICATE_CANDIDATE' : warnings.length ? 'WARNING' : 'VALID';
    const mappedJson = JSON.stringify(mapped); if (mappedJson.length > 4000) throw new AppError('VALIDATION_ERROR', 'Mapped data exceeds the preview row storage limit.', 400);
    const updated = await adminTables.updateRow(databaseId, 'import_batch_rows', existing.$id, { ...existing, mapped_row: mappedJson, validation_status: status, validation_errors: errors, validation_warnings: warnings, duplicate_company_id: duplicateCompanyId });
    const counts = { valid_rows: 0, warning_rows: 0, invalid_rows: 0 };
    for (const row of duplicatesInBatch.rows) {
      const candidate = row.$id === updated.$id ? updated : row;
      if (candidate.validation_status === 'INVALID') counts.invalid_rows += 1;
      else if (['WARNING', 'DUPLICATE_CANDIDATE'].includes(candidate.validation_status)) counts.warning_rows += 1;
      else counts.valid_rows += 1;
    }
    await adminTables.updateRow(databaseId, 'import_batches', batch.$id, { ...batch, ...counts, updated_at: now() });
    response.json({ ok: true, data: { id: updated.$id, rowNumber: updated.row_number, mapped, status, errors, warnings, duplicateCompanyId }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.post('/imports/:batchId/cancel', async (request, response, next) => {
  try { const { member } = request.auth; const batch = await getRow('import_batches', request.params.batchId); if (member.role !== 'SUPER_ADMIN' && batch.created_by !== member.user_id) throw new AppError('FORBIDDEN', 'You can only cancel import batches you created.', 403); if (batch.status !== 'PREVIEW') throw new AppError('CONFLICT', 'Only a preview can be cancelled.', 409); const updated = await adminTables.updateRow(databaseId, 'import_batches', batch.$id, { ...batch, status: 'CANCELLED', completed_at: now(), updated_at: now() }); response.json({ ok: true, data: { id: updated.$id, status: updated.status }, meta: { requestId: requestId(request) } }); } catch (error) { next(error); }
});

router.post('/imports/:batchId/undo', async (request, response, next) => {
  try {
    const { member } = request.auth; const batch = await getRow('import_batches', request.params.batchId);
    if (member.role !== 'SUPER_ADMIN' && batch.created_by !== member.user_id) throw new AppError('FORBIDDEN', 'You can only undo an import batch you created.', 403);
    if (batch.status !== 'COMPLETED') throw new AppError('CONFLICT', 'Only a fully completed import can be undone. Resolve partial imports manually from their row report.', 409);
    const entries = (await listRowsComplete('import_batch_rows', [sdk.Query.equal('batch_id', [batch.$id])])).rows;
    const planned = { leads: new Map(), contacts: new Map(), companies: new Map() };
    for (const entry of entries.filter((row) => row.save_status === 'CREATED')) {
      if (entry.created_lead_id) planned.leads.set(entry.created_lead_id, await getRow('leads', entry.created_lead_id));
      for (const id of entry.created_contact_ids || []) planned.contacts.set(id, await getRow('contacts', id));
      if (entry.created_company_id) { const company = await getRow('companies', entry.created_company_id); if (String(company.source_notes || '').includes(batch.$id)) planned.companies.set(company.$id, company); }
    }
    for (const [table, records] of Object.entries(planned)) for (const [id, row] of records) {
      if (row.created_by !== batch.created_by || new Date(row.updated_at).getTime() > new Date(row.created_at).getTime()) throw new AppError('CONFLICT', `Record ${id} was changed after import; undo stopped without deleting anything.`, 409);
      const events = await listRowsComplete('activity_logs', [sdk.Query.equal('entity_type', [table]), sdk.Query.equal('entity_id', [id])]);
      if (events.rows.some((event) => event.action_type !== 'CREATE')) throw new AppError('CONFLICT', `Record ${id} has activity after creation; undo stopped without deleting anything.`, 409);
    }
    const contactReferenceTables = [['communications', 'contact_id'], ['opportunities', 'contact_id'], ['academic_confirmations', 'contact_id'], ['resume_shares', 'shared_with_contact_id'], ['interviews', 'interviewer_contact_id']];
    for (const id of planned.contacts.keys()) for (const [table, field] of contactReferenceTables) {
      const refs = await listRowsComplete(table, [sdk.Query.equal(field, [id])]);
      if (refs.rows.length) throw new AppError('CONFLICT', `Contact ${id} is now referenced by ${table}; undo stopped without deleting anything.`, 409);
    }
    const companyReferenceTables = [['opportunities', 'company_id'], ['communications', 'company_id'], ['followups', 'company_id'], ['academic_confirmations', 'company_id'], ['documents', 'related_entity_id'], ['legacy_source_rows', 'company_id']];
    for (const id of planned.companies.keys()) {
      for (const [table, field] of [['contacts', 'company_id'], ['leads', 'company_id'], ...companyReferenceTables]) {
        const refs = await listRowsComplete(table, [sdk.Query.equal(field, [id])]);
        const remaining = refs.rows.filter((row) => !(table === 'contacts' && planned.contacts.has(row.$id)) && !(table === 'leads' && planned.leads.has(row.$id)) && !(table === 'documents' && row.related_entity_type !== 'COMPANY'));
        if (remaining.length) throw new AppError('CONFLICT', `Company ${id} has records linked after import; undo stopped without deleting anything.`, 409);
      }
    }
    for (const [id, row] of planned.leads) { await adminTables.deleteRow(databaseId, 'leads', id); await audit(member, 'UNDO_CREATE', 'leads', id, { source: 'BULK_IMPORT' }, null, request); }
    for (const [id, row] of planned.contacts) { await adminTables.deleteRow(databaseId, 'contacts', id); await audit(member, 'UNDO_CREATE', 'contacts', id, { source: 'BULK_IMPORT' }, null, request); }
    for (const [id, row] of planned.companies) { await adminTables.deleteRow(databaseId, 'companies', id); await audit(member, 'UNDO_CREATE', 'companies', id, { source: 'BULK_IMPORT' }, null, request); }
    for (const entry of entries.filter((row) => row.save_status === 'CREATED')) await adminTables.updateRow(databaseId, 'import_batch_rows', entry.$id, { ...entry, save_status: 'UNDONE' });
    const updated = await adminTables.updateRow(databaseId, 'import_batches', batch.$id, { ...batch, status: 'UNDONE', completed_at: now(), updated_at: now(), error_summary: 'Batch additions were undone.' });
    await audit(member, 'UNDO_IMPORT', 'import_batches', batch.$id, { status: batch.status }, { status: updated.status, deleted_companies: planned.companies.size, deleted_contacts: planned.contacts.size, deleted_leads: planned.leads.size }, request);
    response.json({ ok: true, data: { id: batch.$id, status: updated.status, deleted: { companies: planned.companies.size, contacts: planned.contacts.size, leads: planned.leads.size } }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});

router.post('/imports/:batchId/commit', async (request, response, next) => {
  try {
    const { member } = request.auth; const batch = await getRow('import_batches', request.params.batchId);
    if (member.role !== 'SUPER_ADMIN' && batch.created_by !== member.user_id) throw new AppError('FORBIDDEN', 'You can only commit import batches you created.', 403);
    if (batch.status === 'COMPLETED') { const oldRows = await listRowsComplete('import_batch_rows', [sdk.Query.equal('batch_id', [batch.$id])]); return response.json({ ok: true, data: { status: batch.status, rows: oldRows.rows.map((row) => ({ rowNumber: row.row_number, saveStatus: row.save_status, error: row.error_message })), createdRecords: batch.created_records, skippedRecords: batch.skipped_records }, meta: { requestId: requestId(request) } }); }
    if (!['PREVIEW', 'PARTIAL_SUCCESS', 'FAILED'].includes(batch.status)) throw new AppError('CONFLICT', 'This batch is already being processed or cannot be committed.', 409);
    const entries = await listRowsComplete('import_batch_rows', [sdk.Query.equal('batch_id', [batch.$id])]);
    const actions = request.body?.actions && typeof request.body.actions === 'object' ? request.body.actions : {};
    for (const entry of entries.rows) { const action = actions[entry.$id]; const companyAction = typeof action === 'string' ? action : action?.company; const skip = action === 'SKIP' || action?.skip === true || companyAction === 'SKIP'; if (entry.validation_status === 'DUPLICATE_CANDIDATE' && !skip && !['USE_EXISTING', 'CREATE_NEW'].includes(companyAction)) throw new AppError('VALIDATION_ERROR', `Choose an action for duplicate candidate on pasted row ${entry.row_number}.`, 400); }
    const timestamp = now(); await adminTables.updateRow(databaseId, 'import_batches', batch.$id, { ...batch, status: 'PROCESSING', updated_at: timestamp });
    const groupCompanies = new Map(); let createdRecords = 0; let skippedRecords = 0; let failed = false;
    for (const entry of entries.rows) {
      if (!['NOT_SAVED', 'FAILED'].includes(entry.save_status)) continue;
      const selectedAction = actions[entry.$id];
      if (entry.validation_status === 'INVALID' || selectedAction === 'SKIP' || selectedAction?.skip === true || selectedAction?.company === 'SKIP') { await adminTables.updateRow(databaseId, 'import_batch_rows', entry.$id, { ...entry, save_status: 'SKIPPED' }); skippedRecords += 1; continue; }
      try {
        const mapped = JSON.parse(entry.mapped_row); let company = groupCompanies.get(mapped.normalized_name);
        const rowAction = actions[entry.$id] || ''; const action = typeof rowAction === 'string' ? rowAction : rowAction.company || '';
        if (!company && entry.duplicate_company_id && action === 'USE_EXISTING') company = await getRow('companies', entry.duplicate_company_id);
        if (!company) {
          const companyHash = crypto.createHash('sha256').update(mapped.normalized_name).digest('hex').slice(0, 12);
          const companyId = `imco_${batch.$id.slice(-12)}_${companyHash}`;
          try { company = await adminTables.getRow(databaseId, 'companies', companyId); }
          catch { const data = { company_name: mapped.company_name, normalized_name: mapped.normalized_name, website: /^https?:\/\//i.test(mapped.website || '') ? mapped.website : '', careers_url: '', linkedin_url: '', industry: mapped.industry || '', sector: '', organization_type: '', organization_category: 'PRIVATE', city: mapped.location || '', state: '', country: 'India', full_address: '', general_email: '', general_phone: '', company_description: '', target_branches: (mapped.branches || '').split(/[,;|]/).map((value) => value.trim()).filter(Boolean), source_urls: [], source_notes: `Bulk paste import ${batch.$id}, row ${entry.row_number}`, company_status: 'ACTIVE', owner_member_id: member.user_id, created_at: timestamp, created_by: member.user_id, updated_at: timestamp, updated_by: member.user_id, is_archived: false }; company = await adminTables.createRow(databaseId, 'companies', companyId, data); await audit(member, 'CREATE', 'companies', companyId, null, { company_name: mapped.company_name, source: 'BULK_IMPORT' }, request); createdRecords += 1; }
        }
        groupCompanies.set(mapped.normalized_name, company);
        let createdContactIds = [];
        if (mapped.contact_name || mapped.work_email || mapped.phone) {
          const contactId = `imct_${crypto.createHash('sha256').update(entry.$id).digest('hex').slice(0, 30)}`;
          let contact;
          try { contact = await adminTables.getRow(databaseId, 'contacts', contactId); }
          catch { const timestampNow = now(); const data = { company_id: company.$id, full_name: mapped.contact_name || '', first_name: '', last_name: '', designation: '', department: '', contact_context: mapped.lead_notes || '', work_email: mapped.work_email && /^\S+@\S+\.\S+$/.test(mapped.work_email) ? mapped.work_email : '', normalized_email: mapped.work_email && /^\S+@\S+\.\S+$/.test(mapped.work_email) ? mapped.work_email : '', alternate_email: '', phone: (mapped.phone || '').slice(0, 40), linkedin_url: '', country: 'India', city: mapped.location || '', preferred_channel: mapped.work_email ? 'EMAIL' : 'PHONE', is_primary_contact: false, contact_status: 'UNVERIFIED', source_urls: [], source_notes: `Bulk paste import ${batch.$id}, row ${entry.row_number}`, owner_member_id: member.user_id, created_at: timestampNow, created_by: member.user_id, updated_at: timestampNow, updated_by: member.user_id }; contact = await adminTables.createRow(databaseId, 'contacts', contactId, data); await audit(member, 'CREATE', 'contacts', contactId, null, { full_name: data.full_name, company_id: company.$id }, request); createdRecords += 1; }
          createdContactIds = [contact.$id];
        }
        const leadId = `imld_${crypto.createHash('sha256').update(entry.$id).digest('hex').slice(0, 30)}`; let lead;
        try { lead = await adminTables.getRow(databaseId, 'leads', leadId); }
        catch { const timestampNow = now(); const data = { company_id: company.$id, lead_source: 'OTHER', source_details: `Bulk paste import ${batch.$id}, row ${entry.row_number}`, research_notes: mapped.lead_notes || '', target_department: '', lead_status: 'NEW', priority: 'NORMAL', owner_member_id: member.user_id, assigned_member_id: '', last_contacted_at: '', next_followup_at: '', created_at: timestampNow, created_by: member.user_id, updated_at: timestampNow, updated_by: member.user_id, is_archived: false }; lead = await adminTables.createRow(databaseId, 'leads', leadId, data); await audit(member, 'CREATE', 'leads', leadId, null, { company_id: company.$id, source: 'BULK_IMPORT' }, request); createdRecords += 1; }
        await adminTables.updateRow(databaseId, 'import_batch_rows', entry.$id, { ...entry, save_status: 'CREATED', created_company_id: company.$id, created_contact_ids: createdContactIds, created_lead_id: lead.$id, error_message: '' });
      } catch (error) { failed = true; const message = String(error.message || 'Save failed').slice(0, 1000); await adminTables.updateRow(databaseId, 'import_batch_rows', entry.$id, { ...entry, save_status: 'FAILED', error_message: message }); }
    }
    const finalRows = await listRowsComplete('import_batch_rows', [sdk.Query.equal('batch_id', [batch.$id])]);
    const actualSkipped = finalRows.rows.filter((row) => row.save_status === 'SKIPPED').length; const finalStatus = failed || finalRows.rows.some((row) => row.save_status === 'FAILED') ? 'PARTIAL_SUCCESS' : 'COMPLETED';
    const totalCreatedRecords = (batch.created_records || 0) + createdRecords;
    await adminTables.updateRow(databaseId, 'import_batches', batch.$id, { ...batch, status: finalStatus, completed_at: now(), created_records: totalCreatedRecords, skipped_records: actualSkipped, error_summary: failed ? 'One or more rows failed; inspect row results.' : '', updated_at: now() });
    response.json({ ok: true, data: { status: finalStatus, createdRecords: totalCreatedRecords, skippedRecords: actualSkipped, failedRows: finalRows.rows.filter((row) => row.save_status === 'FAILED').length, rows: finalRows.rows.map((row) => ({ rowNumber: row.row_number, saveStatus: row.save_status, error: row.error_message })) }, meta: { requestId: requestId(request) } });
  } catch (error) { next(error); }
});


module.exports = { router, errorHandler: (error, _request, response, _next) => { const status = error.status || 500; if (status >= 500) console.error(error); response.status(status).json({ ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: status >= 500 ? 'An unexpected server error occurred.' : error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) } }); } };
