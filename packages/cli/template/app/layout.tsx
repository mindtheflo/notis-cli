import '@notis/sdk/styles.css';
import { ShortcutProvider } from '@notis/sdk/interactions';
import './globals.css';

export default function AppShell({ children }: { children: React.ReactNode }) {
  // NotisProvider supplies this in the product host. Keeping the shell-level
  // provider makes the same scope arbitration available in the local harness;
  // ShortcutProvider is nesting-safe, so the hosted app still has one registry.
  return <ShortcutProvider>{children}</ShortcutProvider>;
}
