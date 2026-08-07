import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NotisProvider } from '@notis/sdk';
import AppShell from '../app/layout';
import JournalPage from '../app/page';
import InsightsPage from '../app/insights/page';
import { installMockRuntime } from './mock-runtime';

const runtime = installMockRuntime();

function DevPreview() {
  const [route, setRoute] = useState<'journal' | 'insights'>('journal');

  useEffect(() => {
    const onNav = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string };
      if (detail?.path?.includes('insights')) setRoute('insights');
      else if (detail?.path === '/') setRoute('journal');
    };
    window.addEventListener('mock-navigate', onNav);
    return () => window.removeEventListener('mock-navigate', onNav);
  }, []);

  return (
    <div data-dev-preview className="min-h-screen bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2 text-xs">
        <span className="font-semibold text-muted-foreground">Dev preview</span>
        {(['journal', 'insights'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRoute(r)}
            className={
              'rounded-md px-2.5 py-1 font-medium capitalize ' +
              (route === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')
            }
          >
            {r}
          </button>
        ))}
      </div>
      {route === 'journal' ? <JournalPage /> : <InsightsPage />}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <NotisProvider runtime={runtime}>
      <AppShell>
        <DevPreview />
      </AppShell>
    </NotisProvider>
  </StrictMode>,
);
