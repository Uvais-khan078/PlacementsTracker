import { useState, useEffect } from 'react';

const API_URL = 'http://localhost:5000/api/health';

function App() {
  const [status, setStatus] = useState('loading'); // loading | connected | error
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const checkConnection = async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch(API_URL);
      const json = await res.json();
      setData(json);
      setStatus('connected');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Placement Tracker</h1>
      <p style={styles.subtitle}>
        Track your placement journey — applications, interviews, and offers.
      </p>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Backend Connection</h2>

        {status === 'loading' && (
          <p style={styles.loading}>Checking connection...</p>
        )}

        {status === 'connected' && data && (
          <div style={styles.successBox}>
            <span style={styles.badge}>● Connected</span>
            <p style={styles.successText}>{data.message}</p>
            <p style={styles.meta}>Server time: {data.timestamp}</p>
            <p style={styles.meta}>API: {API_URL}</p>
          </div>
        )}

        {status === 'error' && (
          <div style={styles.errorBox}>
            <span style={styles.badgeError}>● Not Connected</span>
            <p style={styles.errorText}>
              Frontend could not reach the backend.
            </p>
            <p style={styles.meta}>
              Make sure the backend is running on port 5000.
            </p>
            <p style={styles.meta}>Error: {error}</p>
          </div>
        )}

        <button style={styles.button} onClick={checkConnection}>
          Recheck Connection
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: '600px',
    margin: '40px auto',
    padding: '0 20px',
    color: '#1f2937',
  },
  title: {
    fontSize: '2.5rem',
    marginBottom: '8px',
    color: '#2563eb',
  },
  subtitle: {
    fontSize: '1.1rem',
    marginBottom: '32px',
    color: '#6b7280',
  },
  card: {
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '24px',
    background: '#f9fafb',
  },
  cardTitle: {
    marginTop: 0,
  },
  loading: {
    color: '#6b7280',
  },
  successBox: {
    background: '#ecfdf5',
    border: '1px solid #a7f3d0',
    borderRadius: '8px',
    padding: '16px',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '16px',
  },
  badge: {
    color: '#059669',
    fontWeight: 'bold',
  },
  badgeError: {
    color: '#dc2626',
    fontWeight: 'bold',
  },
  successText: {
    margin: '8px 0 4px',
    color: '#065f46',
  },
  errorText: {
    margin: '8px 0 4px',
    color: '#991b1b',
  },
  meta: {
    fontSize: '0.85rem',
    color: '#6b7280',
    margin: '4px 0',
  },
  button: {
    marginTop: '16px',
    padding: '10px 20px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
  },
};

export default App;
