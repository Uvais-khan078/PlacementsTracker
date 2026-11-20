'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { router: apiRouter, errorHandler } = require('./routes');
const { adminTables, adminStorage, databaseId, missingConfiguration, recruitmentBucketId, sdk } = require('./appwrite');

const app = express();
const port = Number(process.env.PORT || 5000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const trustedProxyHops = process.env.TRUST_PROXY === '1' ? 1 : false;
app.set('trust proxy', trustedProxyHops);
app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use('/api/auth/login-target', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' } } }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_request, response) => {
  response.json({ name: 'UKTech T&P API', status: 'running' });
});

app.get('/api/status', (_request, response) => {
  const configured = missingConfiguration.length === 0;
  response.status(configured ? 200 : 503).json({
    ok: configured,
    service: 'uktech-tp-backend',
    status: configured ? 'running' : 'configuration_required',
    ...(configured ? {} : { missingConfiguration }),
  });
});

app.get('/api/health', async (_request, response) => {
  if (missingConfiguration.length) {
    return response.status(503).json({ status: 'degraded', service: 'uktech-tp-backend', appwrite: { configured: false, missingConfiguration } });
  }
  let databaseReachable = false; let storageReady = false;
  try { await adminTables.listRows({ databaseId, tableId: 'members', queries: [sdk.Query.limit(1)] }); databaseReachable = true; }
  catch (error) { console.error(`Appwrite database health probe failed: ${error.code || 'unknown'}`); }
  try {
    const bucket = await adminStorage.getBucket({ bucketId: recruitmentBucketId });
    const permissions = bucket.$permissions || bucket.permissions || [];
    storageReady = Boolean(bucket.enabled && bucket.encryption && bucket.fileSecurity && permissions.length === 0);
  } catch (error) { console.error(`Appwrite Storage health probe failed: ${error.code || 'unknown'}`); }
  const ready = databaseReachable && storageReady;
  response.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'degraded', service: 'uktech-tp-backend', appwrite: { configured: true, databaseReachable, storageReady }, timestamp: new Date().toISOString() });
});

app.use('/api', apiRouter);
app.use(errorHandler);

if (require.main === module) {
  app.listen(port, () => {
    console.log(`UKTech T&P API listening on http://localhost:${port}`);
  });
}

module.exports = app;
