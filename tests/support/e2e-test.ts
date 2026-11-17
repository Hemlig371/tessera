import { test as base } from '@playwright/test';
export * from '@playwright/test';
/** Context disposal can abort fetch without firing pagehide. Release server ownership explicitly. */
export const test = base.extend<{ rendererCleanup: void }>({
  rendererCleanup: [async ({ request }, use) => {
    await use();
    const response = await request.post('/__test-sqlite',{ data: { op: 'renderer-cleanup' },timeout: 15000 });
    if (!response.ok()) throw new Error('Renderer SQLite cleanup failed: '+await response.text());
  },{ auto: true }],
});
