import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotisProvider } from '@notis/sdk';
import AppShell from '../app/layout';
import CatalogPage from '../app/page';
import { installMockRuntime } from './mock-runtime';

const runtime = installMockRuntime();

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <NotisProvider runtime={runtime}>
      <AppShell>
        <div data-dev-preview className="h-screen w-screen bg-background text-foreground">
          <CatalogPage />
        </div>
      </AppShell>
    </NotisProvider>
  </StrictMode>,
);
