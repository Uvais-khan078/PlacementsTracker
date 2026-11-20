/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APPWRITE_ENDPOINT?: string;
  readonly VITE_APPWRITE_PROJECT_ID?: string;
  readonly VITE_APPWRITE_DATABASE_ID?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_BACKEND_UPLOAD_LIMIT_MB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
