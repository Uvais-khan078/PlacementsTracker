import { RecordsLoadingState } from '../system/SystemScreens';
import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';

type MeetingNote = { id: string; title: string; meeting_date: string; content: string; source_filename: string; source_path: string; created_at: string };

export default function MeetingNotesPage() {
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [selected, setSelected] = useState<MeetingNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { setNotes(await apiRequest<MeetingNote[]>('/meeting-notes')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load meeting notes.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  return <section className="module-page">
    <div className="module-header"><div><p className="eyebrow">Committee archive</p><h2>Meeting notes</h2><p className="muted">Imported source notes are preserved as written and are separate from company activity records.</p></div><button className="text-button" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button></div>
    {error && <div className="inline-error">{error}</div>}
    <div className="content-panel company-table">
      <div className="panel-heading"><div><p className="eyebrow">Source archive</p><h3>{loading ? 'Loading…' : `notes.length meeting notes`}</h3></div></div>
      {loading ? <RecordsLoadingState label="meeting notes" /> : notes.length === 0 ? <div className="empty-state"><strong>No meeting notes imported</strong><p>Imported committee documents will appear here.</p></div> : <div className="table-scroll"><table><thead><tr><th>Meeting</th><th>Record ID</th><th>Date</th><th>Source file</th><th>Imported</th></tr></thead><tbody>{notes.map((note) => <tr key={note.id}><td><button className="record-link" onClick={() => setSelected(note)}><strong>{note.title}</strong></button></td><td><code className="record-id">{note.id}</code></td><td>{new Date(note.meeting_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td><td>{note.source_filename}</td><td>{new Date(note.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td></tr>)}</tbody></table></div>}
    </div>
    {selected && <div className="member-detail-backdrop" onClick={() => setSelected(null)}><section className="content-panel member-detail business-detail" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="panel-heading"><div><p className="eyebrow">{new Date(selected.meeting_date).toLocaleDateString('en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' })}</p><h3>{selected.title}</h3></div><button className="text-button" onClick={() => setSelected(null)}>Close</button></div><p className="muted">Source: {selected.source_path}</p><pre className="meeting-note-content">{selected.content}</pre></section></div>}
  </section>;
}
