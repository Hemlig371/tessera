/** Close SQLite before removing the temporary 50K fixture, including on Windows. */
export default async function teardown() {
  const response = await fetch('http://127.0.0.1:1420/__test-sqlite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'cleanup' }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('E2E SQLite cleanup failed');
}
