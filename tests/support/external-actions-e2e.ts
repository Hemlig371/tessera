// Explicit browser-harness adapter; this does not claim to open the real OS browser.
export async function openExternalUrl(url: string): Promise<void> { document.documentElement.setAttribute('data-acceptance-external', url); }
