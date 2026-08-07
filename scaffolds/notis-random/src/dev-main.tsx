// Dev entrypoint: mounts the app pages with a tiny hash-router and the mock
// runtime. Not used in production — `vite build` uses .notis/_entry.tsx.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NotisProvider } from '@notis/sdk';
import AppShell from '../app/layout';
import HomePage from '../app/page';
import HistoryPage from '../app/history/page';
import { installMockRuntime, setMockRoute } from './mock-runtime';

const runtime = installMockRuntime(hashRoute());

function hashRoute(): 'home' | 'history' {
  return window.location.hash === '#/history' ? 'history' : 'home';
}

function DevApp() {
  const [route, setRoute] = useState<'home' | 'history'>(hashRoute());

  useEffect(() => {
    const onChange = () => {
      const next = hashRoute();
      setRoute(next);
      setMockRoute(next);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const Page = route === 'history' ? HistoryPage : HomePage;

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <nav className="flex items-center gap-2 rounded-full border border-border bg-card p-1 text-sm w-fit">
          <a
            href="#/"
            className={
              (route === 'home' ? 'bg-accent text-accent-foreground ' : 'text-muted-foreground hover:text-foreground ') +
              'rounded-full px-3 py-1 transition'
            }
          >
            Generator
          </a>
          <a
            href="#/history"
            className={
              (route === 'history' ? 'bg-accent text-accent-foreground ' : 'text-muted-foreground hover:text-foreground ') +
              'rounded-full px-3 py-1 transition'
            }
          >
            History
          </a>
          <span className="pl-2 pr-3 text-[10px] uppercase tracking-wide text-muted-foreground">dev preview</span>
        </nav>
      </div>
      <Page />
    </AppShell>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');
createRoot(root).render(
  <StrictMode>
    <NotisProvider runtime={runtime}>
      <DevApp />
    </NotisProvider>
  </StrictMode>,
);
