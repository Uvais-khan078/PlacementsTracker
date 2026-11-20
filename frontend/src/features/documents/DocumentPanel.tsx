import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { createSessionJwt } from '../../lib/appwrite/auth';

type EntityType = 'COMPANY' | 'OPPORTUNITY' | 'APPLICATION' | 'ACADEMIC_CONFIRMATION';
type DocumentRow = { id: string; file_name: string; mime_type: string; file_size: number; created_at: string };
type StorageStatus = { ready: boolean; message?: string; buckets?: { bucket_id: string; max_file_size: number; allowed_extensions: string[] }[] };
const backendUrl = import.meta.env.VITE_BACKEND_URL === undefined ? 'http://localhost:5000' : import.meta.env.VITE_BACKEND_URL;

export default function DocumentPanel({ entityType, entityId, title, isSuperAdmin = false }: { entityType: EntityType; entityId: string; title: string; isSuperAdmin?: boolean }) {
  const [ready, setReady] = useState(false); const [maxFileSize,setMaxFileSize]=useState(20*1024*1024); const [allowedExtensions,setAllowedExtensions]=useState<string[]>(['pdf','doc','docx','xls','xlsx','png','jpg','jpeg']); const [statusMessage, setStatusMessage] = useState('Checking private Storage…'); const [rows, setRows] = useState<DocumentRow[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const input = useRef<HTMLInputElement>(null);
  const deploymentUploadLimitMb = Number(import.meta.env.VITE_BACKEND_UPLOAD_LIMIT_MB || 20);
  const effectiveMaxFileSize = Math.min(maxFileSize, (Number.isFinite(deploymentUploadLimitMb) && deploymentUploadLimitMb > 0 ? deploymentUploadLimitMb : 20) * 1024 * 1024);
  const load = async () => {
    try {
      const status = await apiRequest<StorageStatus>('/storage/status'); setReady(status.ready); if(status.buckets?.[0]){setMaxFileSize(status.buckets[0].max_file_size);setAllowedExtensions(status.buckets[0].allowed_extensions);} setStatusMessage(status.ready ? '' : status.message || 'Private Storage is not configured.');
    } catch (e) { setReady(false); setRows([]); setStatusMessage(e instanceof Error ? e.message : 'Unable to check private Storage.'); }
    try { setRows(await apiRequest<DocumentRow[]>(`/documents?entity_type=${entityType}&entity_id=${entityId}`)); }
    catch (e) { setRows([]); if (!(e instanceof Error && /Storage access|private Storage bucket|private Storage|Storage bucket/i.test(e.message))) setError(e instanceof Error ? e.message : 'Unable to load documents.'); }
  };
  useEffect(() => { void load(); }, [entityType, entityId]);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); setError('');
    try {
      if (file.size > effectiveMaxFileSize) throw new Error(`Choose a file smaller than ${(effectiveMaxFileSize/1024/1024).toFixed(0)} MB. This deployment has a server upload size limit.`);
      const jwt = await createSessionJwt();
      const response = await fetch(`${backendUrl}/api/documents/upload`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Related-Entity-Type': entityType, 'X-Related-Entity-Id': entityId }, body: file });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || 'Document upload failed.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Document upload failed.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async (row: DocumentRow) => { if(!window.confirm(`Remove ${row.file_name} from this record?`))return;setBusy(true);setError('');try{await apiRequest(`/documents/${row.id}`,{method:'DELETE'});await load();}catch(e){setError(e instanceof Error?e.message:'Unable to remove document.');}finally{setBusy(false);}};
  const download = async (row: DocumentRow) => {
    setBusy(true); setError('');
    try {
      const jwt = await createSessionJwt(); const response = await fetch(`${backendUrl}/api/documents/${row.id}/download`, { headers: { Authorization: `Bearer ${jwt}` } });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error?.message || 'Download failed.'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = row.file_name; anchor.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Download failed.'); }
    finally { setBusy(false); }
  };
  return <section className="document-panel"><div className="document-panel-heading"><div><h4>{title}</h4><span>{rows.length} files</span></div><label className={`secondary-button compact document-upload ${!ready || busy ? 'disabled' : ''}`}><input ref={input} type="file" accept={allowedExtensions.map((extension)=>`.${extension}`).join(',')} disabled={!ready || busy} onChange={upload} />{busy ? 'Working…' : 'Upload file'}</label></div>{!ready && <p className="document-storage-note">{statusMessage} Required backend scopes: `buckets.read`, `buckets.write`, `files.read`, `files.write` and `files.delete`.</p>}{error && <p className="inline-error">{error}</p>}{rows.length > 0 && <ul className="document-list">{rows.map((row) => <li key={row.id}><div><strong>{row.file_name}</strong><small>{(row.file_size / 1024).toFixed(0)} KB · {new Date(row.created_at).toLocaleDateString()}</small></div><div className="member-actions"><button className="text-button" onClick={() => void download(row)} disabled={busy}>Download</button>{isSuperAdmin&&<button className="text-button danger-text" onClick={()=>void remove(row)} disabled={busy}>Remove</button>}</div></li>)}</ul>}</section>;
}
