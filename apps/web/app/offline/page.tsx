export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-5xl">📡</p>
      <h1 className="mt-4 text-2xl font-bold">You’re offline</h1>
      <p className="mt-2 max-w-sm text-muted">No worries — your balance and progress are safe on our servers. Reconnect and pick up where you left off.</p>
    </div>
  );
}
