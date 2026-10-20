import './globals.css';

export default function AppShell({ children }: { children: React.ReactNode }) {
  // The host provides the SDK, its keyboard engine and the toolkit stylesheet.
  return <>{children}</>;
}
