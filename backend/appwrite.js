'use strict';

const sdk = require('node-appwrite');

const endpoint = (process.env.APPWRITE_ENDPOINT || '').replace(/\/$/, '');
const projectId = process.env.APPWRITE_PROJECT_ID;
const databaseId = process.env.APPWRITE_DATABASE_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const recruitmentBucketId = process.env.APPWRITE_RECRUITMENT_BUCKET_ID || process.env.APPWRITE_STORAGE_BUCKET_ID || 'recruitment-documents';

if (!endpoint || !projectId || !databaseId || !apiKey) {
  throw new Error('Appwrite server configuration is incomplete.');
}

const adminClient = new sdk.Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const adminTables = new sdk.TablesDB(adminClient);
const adminUsers = new sdk.Users(adminClient);
const adminStorage = new sdk.Storage(adminClient);
const authenticationInFlight = new Map();

function getJwtClient(jwt) {
  return new sdk.Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
}

async function getAuthenticatedUser(jwt) {
  if (!jwt) throw new AppError('UNAUTHENTICATED', 'A valid Appwrite session is required.', 401);
  try {
    return await new sdk.Account(getJwtClient(jwt)).get();
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.', 401);
  }
}

async function getMemberProfile(userId) {
  const result = await adminTables.listRows({
    databaseId,
    tableId: 'members',
    queries: [sdk.Query.equal('user_id', [userId]), sdk.Query.limit(1)],
  });
  const profile = result.rows[0];
  if (!profile) throw new AppError('MEMBER_PROFILE_NOT_FOUND', 'Your account is not provisioned for UKTech T&P.', 403);
  if (!profile.is_active) throw new AppError('ACCOUNT_INACTIVE', 'This account has been deactivated.', 403);
  if (!['SUPER_ADMIN', 'COMMITTEE_MEMBER'].includes(profile.role)) {
    throw new AppError('FORBIDDEN', 'This account has an unsupported application role.', 403);
  }
  return profile;
}

async function authenticateRequest(request) {
  const header = request.get('authorization') || '';
  const jwt = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!jwt) throw new AppError('UNAUTHENTICATED', 'A valid Appwrite session is required.', 401);
  const existing = authenticationInFlight.get(jwt);
  if (existing) return existing;
  const pending = (async () => {
    const user = await getAuthenticatedUser(jwt);
    const member = await getMemberProfile(user.$id);
    return { user, member };
  })();
  authenticationInFlight.set(jwt, pending);
  try { return await pending; }
  finally { if (authenticationInFlight.get(jwt) === pending) authenticationInFlight.delete(jwt); }
}

class AppError extends Error {
  constructor(code, message, status = 400, fieldErrors = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

module.exports = { AppError, adminTables, adminUsers, adminStorage, authenticateRequest, databaseId, recruitmentBucketId, sdk };
