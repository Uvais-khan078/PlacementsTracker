import { Client } from 'appwrite';

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT;
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID;

if (!endpoint || !projectId) {
  console.warn('Appwrite public configuration is incomplete. Copy frontend/.env.example to frontend/.env.local.');
}

export const appwriteClient = new Client()
  .setEndpoint(endpoint || 'https://cloud.appwrite.io/v1')
  .setProject(projectId || 'unconfigured-project');

export const appwriteConfig = {
  endpoint: endpoint || '',
  projectId: projectId || '',
  databaseId: import.meta.env.VITE_APPWRITE_DATABASE_ID || '',
};
