import type { ReactNode } from 'react';
import '@notis/sdk/styles.css';
import './globals.css';

export default function AppShell({ children }: { children: ReactNode }) {
  return children;
}
