import { useEffect, useState } from 'react';

type Health = { status: string; db: string };

// Temporary home page for the live skeleton: shows whether the API and database are up.
// Task T03 replaces it with the real app shell (router, theme, i18n).
export default function App() {
  const [health, setHealth] = useState<Health | 'loading' | 'unreachable'>('loading');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth, () => setHealth('unreachable'));
  }, []);

  const text =
    health === 'loading' ? 'API: …' : health === 'unreachable' ? 'API: unreachable' : `API: ${health.status} · DB: ${health.db}`;

  return (
    <main>
      <h1>Sổ chi tiêu</h1>
      <p role="status">{text}</p>
    </main>
  );
}
