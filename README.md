# UKTech T&P Placement Tracker

Central Training & Placement workspace for VMSB Uttarakhand Technical University. It uses a React + TypeScript frontend, an Express API, Appwrite Auth, TablesDB and private Storage.

## Features

- Login ID sign-in with TPO-managed accounts and role-based permissions.
- Company, contact, lead, outreach, follow-up, opportunity, student, application, interview and academic-confirmation records.
- Search, filters, reports, dashboard charts, notifications and audit history.
- Spreadsheet copy/paste import, bulk updates, review reports and safe undo.
- Private recruitment evidence documents. Student resume files are not stored in this application.

## Requirements

- Node.js 22.x or newer and npm (Vercel uses Node.js 24.x).
- An Appwrite project with TablesDB, Auth and a private recruitment Storage bucket.
- An Appwrite server API key stored only in the backend environment.

## Run locally

Create the frontend environment file:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

In another terminal, create `backend/.env` from `backend/.env.example`, fill in the server API key, then run:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Open <http://localhost:5173>. Set the public Appwrite endpoint, project ID and database ID in `frontend/.env.local`; these are build-time client settings. Set `VITE_BACKEND_URL=http://localhost:5000` for local development. Never put `APPWRITE_API_KEY` in a `VITE_` variable or frontend file. Public registration is disabled; members sign in with Login IDs provisioned by the TPO.

## Login account onboarding

Default accounts and accounts created by a TPO are marked for mandatory first-login setup. Before the workspace opens, the member must replace the temporary name, add a personal or university email, and set a new password. This status is enforced by the backend until the setup endpoint completes. The additional Super Admin Login ID is `TNP_CELL_UTU` (display name `TNP CELL UTU`). The login provisioning script uses the existing `INITIAL_MEMBER_PASSWORD` setting, or the original default when it is unset; it does not reset passwords on existing accounts.

After updating the database schema, provision or reconcile the initial accounts with:

```bash
cd backend
SETUP_TABLES=members npm run setup:appwrite
npm run provision:login-accounts
```

## Validation

```bash
cd frontend
npm run typecheck
npm run build

cd ../backend
npm run check
```

## Deploy to the supplied Vercel projects

This repository has separate project roots for the two Vercel deployments. The frontend uses `frontend/`; the Express API uses `backend/`. Each folder includes its own `vercel.json`.

### Backend project

Set the Vercel project's Root Directory to `backend` and configure these Production Environment Variables from `backend/.env.example`:

- `APPWRITE_ENDPOINT`
- `APPWRITE_PROJECT_ID`
- `APPWRITE_DATABASE_ID`
- `APPWRITE_API_KEY` (server-only, least privilege)
- `APPWRITE_RECRUITMENT_BUCKET_ID`
- `FRONTEND_ORIGIN=https://placements-tracker-utu.vercel.app`
- `TRUST_PROXY=1`

Deploy this project to <https://placements-tracker-backend.vercel.app>. The Express app exports a Vercel-compatible handler and still supports `npm run dev` locally.

### Frontend project

Set the Vercel project's Root Directory to `frontend`, Framework Preset to Vite, Build Command to `npm run build`, and Output Directory to `dist`. Configure these Production Environment Variables before building:

- `VITE_APPWRITE_ENDPOINT`
- `VITE_APPWRITE_PROJECT_ID`
- `VITE_APPWRITE_DATABASE_ID`
- `VITE_BACKEND_URL=https://placements-tracker-backend.vercel.app`
- `VITE_BACKEND_UPLOAD_LIMIT_MB=4`

Deploy to <https://placements-tracker-utu.vercel.app>. The university logo is used as the browser tab icon. The SPA rewrite keeps the app's own 404 screen available on direct navigation.

### Appwrite and upload notes

Add `https://placements-tracker-utu.vercel.app` as an Appwrite Web Platform and allow it in the Auth redirect/domain configuration. Set the backend CORS origin to that exact frontend URL. Keep the Appwrite server key in the backend Vercel environment only.

Vercel Functions cap request and response bodies at 4.5 MB. The Vercel frontend is configured for 4 MB document uploads to stay under that platform limit; local/container deployments can retain the Appwrite bucket's larger upload limit. For larger production uploads, move the upload path to a direct authenticated Appwrite Storage upload or host the API outside Vercel Functions.

After deployment, verify:

1. `https://placements-tracker-backend.vercel.app/api/status` returns a running status.
2. `https://placements-tracker-backend.vercel.app/api/health` reports TablesDB and Storage readiness.
3. The frontend loads, sign-in works, and the browser Network panel shows API requests going to the backend Vercel URL.
4. Appwrite Web Platform/CORS settings include the frontend production origin.

## Data and repository hygiene

Local environment files, deployment output, and the `Central_Placement_Committee_UTU/` source workbook folder are excluded from Git. Markdown documents other than this README are also intentionally ignored. Data import scripts are available under `backend/scripts`; review their dry-run/output and target Appwrite project before running any import. Deployment does not run schema setup or imports automatically.

Never commit Appwrite API keys, member credentials, student records, source workbooks or exported backups.
