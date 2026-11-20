import { Component, type ErrorInfo, type ReactNode } from 'react';

export class AppCrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() { return { crashed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Placement workspace render error:', error, info.componentStack);
  }

  render() {
    if (this.state.crashed) return <main className="system-screen"><section className="system-card"><div className="system-icon error">!</div><p className="eyebrow">Workspace error</p><h1>This page hit a problem</h1><p>Some page data could not be displayed. Reload the workspace to recover. Your saved records are not changed by this screen.</p><div className="system-actions"><button className="primary-button compact" onClick={() => window.location.reload()}>Reload workspace</button><a className="secondary-button compact" href="/">Go to dashboard</a></div></section></main>;
    return this.props.children;
  }
}

export function BackendUnavailableScreen() {
  return <main className="system-screen"><section className="system-card"><div className="system-icon offline"><span /></div><p className="eyebrow">Connection interrupted</p><h1>Can’t reach the placement service</h1><p>The backend is not responding right now. Once it is available, retry to reconnect to your data.</p><div className="system-actions"><button className="primary-button compact" onClick={() => window.location.reload()}>Try again</button><button className="text-button" onClick={() => window.location.assign('/')}>Return to start</button></div><small>We’ll load your workspace again after reconnecting.</small></section></main>;
}

export function NotFoundScreen() {
  return <main className="system-screen"><section className="system-card"><div className="system-code">404</div><p className="eyebrow">Page not found</p><h1>This page doesn’t exist</h1><p>The address may be outdated, or the page may have moved.</p><div className="system-actions"><a className="primary-button compact" href="/">Go to dashboard</a><button className="secondary-button compact" onClick={() => window.history.back()}>Go back</button></div></section></main>;
}

export function DashboardLoadingScreen() {
  return <section className="dashboard-loading" aria-label="Loading placement dashboard" aria-live="polite">
    <div className="loading-intro"><div className="loading-orbit"><span /></div><div><p className="eyebrow">Connecting to your workspace</p><h2>Gathering placement activity</h2><p className="muted">Fetching the latest records and preparing your dashboard…</p></div></div>
    <div className="loading-metrics">{Array.from({ length: 8 }, (_, index) => <div className="loading-metric" key={index}><i /><b /><span /></div>)}</div>
    <div className="loading-panels"><div /><div /></div>
  </section>;
}

export function ModuleLoadingScreen() {
  return <section className="module-loading" aria-label="Opening module" aria-live="polite"><div className="loading-orbit"><span /></div><div><p className="eyebrow">Workspace</p><strong>Opening this section</strong><span>Preparing the page and its records…</span></div></section>;
}

export function RecordsLoadingState({ label = 'records' }: { label?: string }) {
  return <div className="records-loading" role="status" aria-label={`Loading ${label}`}>
    <div className="records-loading-heading"><div className="records-loading-symbol"><span /></div><div><strong>Preparing {label}</strong><span>Syncing the latest workspace data</span></div><i>LIVE SYNC</i></div>
    <div className="records-loading-columns">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>
    {Array.from({ length: 5 }, (_, row) => <div className="records-loading-row" key={row} style={{ animationDelay: `${row * 90}ms` }}>
      <i /><span className="long" /><span /><span className="short" /><b />
    </div>)}
    <div className="records-loading-footer"><span className="records-loading-pulse" />Connecting securely to the placement database…</div>
  </div>;
}
