import { useEffect, useState } from 'react';
import { apiRequest, apiRequestWithMeta } from '../../lib/api';

type SourceRow = { id: string; source_file: string; source_sheet: string; source_row: number; company_id: string; contact_id: string; lead_id: string; skip_reason: string };
type SourceRowDetail = SourceRow & { raw_data: string; source_hash: string; imported_at: string };
const PAGE_SIZE = 50;

export default function SourceArchivePage() {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sourceFile, setSourceFile] = useState('');
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<SourceRowDetail | null>(null);
  const [rawValues, setRawValues] = useState<[string, string][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async (nextOffset = 0, file = sourceFile) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ offset: String(nextOffset) });
      if (file) params.set('source_file', file);
      const result = await apiRequestWithMeta<SourceRow[]>(`/legacy-source-rows?${params}`);
      setRows(result.data); setTotal(Number(result.meta.total ?? result.data.length)); setOffset(Number(result.meta.offset ?? nextOffset));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load the source archive.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(0, sourceFile); }, [sourceFile]);
  useEffect(() => { apiRequest<string[]>('/legacy-source-files').then(setSourceFiles).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load source filenames.')); }, []);
  const open = async (row: SourceRow) => {
    setError('');
    try {
      const detail = await apiRequest<SourceRowDetail>(`/legacy-source-rows/${row.id}`);
      const parsed = JSON.parse(detail.raw_data) as { headers?: unknown[]; cells?: unknown[] };
      const headers = Array.isArray(parsed.headers) ? parsed.headers : [];
      const cells = Array.isArray(parsed.cells) ? parsed.cells : [];
      setRawValues(cells.map((value, index) => [String(headers[index] || `Column ${index + 1}`), String(value ?? '')]));
      setSelected(detail);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load the source row.'); }
  };

  return <section className="module-page">
    <div className="module-header"><div><p className="eyebrow">TPO administration</p><h2>Legacy source archive</h2><p className="muted">Original workbook rows are kept alongside normalized company, contact and lead records for traceability.</p></div><button className="text-button" onClick={() => void load(offset)} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button></div>
    {error && <div className="inline-error">{error}</div>}
    <div className="module-toolbar"><label>Workbook<select value={sourceFile} onChange={(event) => setSourceFile(event.target.value)}><option value="">All source files</option>{sourceFiles.map((file) => <option key={file}>{file}</option>)}</select></label><span className="muted">{loading ? 'Loading archive count…' : `${total.toLocaleString()} archived rows`}</span></div>
    <div className="content-panel company-table"><div className="panel-heading"><div><p className="eyebrow">Raw source rows</p><h3>{loading ? 'Loading source rows…' : `${rows.length} rows shown`}</h3></div><div className="member-actions"><button className="secondary-button compact" disabled={loading || offset <= 0} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}>Previous</button><button className="secondary-button compact" disabled={loading || offset + rows.length >= total} onClick={() => void load(offset + PAGE_SIZE)}>Next</button></div></div>
      {loading ? <div className="archive-loading-table" aria-label="Loading archived rows">{Array.from({ length: 7 }, (_, index) => <div key={index}><i /><i /><i /><i /></div>)}</div> : rows.length === 0 ? <div className="empty-state"><strong>No archived source rows</strong><p>Run the legacy workbook import to preserve the original spreadsheet rows.</p></div> : <div className="table-scroll"><table><thead><tr><th>File</th><th>Record ID</th><th>Sheet</th><th>Source row</th><th>Normalized records</th><th>Import note</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.source_file}</td><td><code className="record-id">{row.id}</code></td><td>{row.source_sheet}</td><td><button className="record-link" onClick={() => void open(row)}>{row.source_row}</button></td><td>{[row.company_id && 'Company', row.contact_id && 'Contact', row.lead_id && 'Lead'].filter(Boolean).join(', ') || '—'}</td><td>{row.skip_reason || 'Imported'}</td></tr>)}</tbody></table></div>}
    </div>
    {selected && <div className="member-detail-backdrop" onClick={() => setSelected(null)}><section className="content-panel member-detail business-detail" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="panel-heading"><div><p className="eyebrow">{selected.source_file} · {selected.source_sheet} · row {selected.source_row}</p><h3>Original spreadsheet values</h3></div><button className="text-button" onClick={() => setSelected(null)}>Close</button></div><dl className="member-facts">{rawValues.map(([key, value], index) => <div key={`${index}:${key}`}><dt>{key}</dt><dd>{value || '—'}</dd></div>)}</dl><p className="muted">Linked to {selected.company_id ? `company ${selected.company_id}` : 'no company'}{selected.contact_id ? ` · contact ${selected.contact_id}` : ''}{selected.lead_id ? ` · lead ${selected.lead_id}` : ''}</p></section></div>}
  </section>;
}
