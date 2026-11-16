import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { Repository } from '../../src/core/repository';

describe.each(adapters)('%s device appearance', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('reads earlier appearance JSON with the default catalog without rewriting local or shared data', async () => {
    f = await fixture(kind);
    const earlier = JSON.stringify({ theme: 'dark', density: 'comfortable', font_scale: 1.15 });
    await f.db.transaction(s => s.execute("INSERT INTO local_settings VALUES('device_appearance',?)", [earlier]));
    expect(await f.api!.getDeviceAppearance()).toEqual({ theme: 'dark', density: 'comfortable', font_scale: 1.15, libraries_layout: 'cards' });
    expect(await f.db.read(s => s.query("SELECT value FROM local_settings WHERE key='device_appearance'"))).toEqual([{ value: earlier }]);
  });
  it('persists on this device without changing shared data, HLC or history; rejects invalid input atomically', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Theme');
    const collection = await api.createCollection(library.id, 'Records', 'Title');
    await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Keep' });
    const snapshot = () => f.db.read(async s => ({ records: await s.query('SELECT * FROM records'), versions: await s.query('SELECT * FROM record_versions'),
      changes: await s.query('SELECT * FROM change_log'), local: await s.query("SELECT * FROM local_settings WHERE key<>'device_appearance' ORDER BY key") }));
    const before = await snapshot();
    expect(await api.getDeviceAppearance()).toEqual({ theme: 'system', density: 'comfortable', font_scale: 1, libraries_layout: 'cards' });
    const setting = { theme: 'dark', density: 'compact', font_scale: 1.5, libraries_layout: 'list' } as const;
    expect(await api.saveDeviceAppearance(setting)).toEqual(setting);
    await expect(api.saveDeviceAppearance({ ...setting, font_scale: 999 })).rejects.toThrow('invalidData');
    await expect(api.saveDeviceAppearance({ ...setting, theme: 'unknown' } as never)).rejects.toThrow('invalidData');
    await expect(api.saveDeviceAppearance({ ...setting, libraries_layout: 'unknown' } as never)).rejects.toThrow('invalidData');
    expect(await snapshot()).toEqual(before);
    const reopened = await f.reopen();
    try { expect(await (await Repository.open(reopened)).getDeviceAppearance()).toEqual(setting); }
    finally { await reopened.close(); }
    expect(await snapshot()).toEqual(before);
  });
});
