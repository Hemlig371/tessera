import { useState, type ReactNode, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, EntryListItem, Field, Library } from '../core/model';
import { choiceConfig, choiceTone } from './choice-appearance';
import { fileIds } from '../core/attachments';
import type { Repository } from '../core/repository';
import { Catalog } from './Catalog';
import { AttachmentThumbnail } from './AttachmentThumbnail';
import { Icon } from './Icon';

function AddButton({label, disabled, onClick}: {label: string; disabled: boolean; onClick: () => void}) {
  return <button className="floating-add" aria-label={label} title={label} disabled={disabled} onClick={onClick}><Icon name="capture"/></button>;
}

type DirectoryProps = Pick<ComponentProps<typeof Catalog>, 'layout' | 'busy' | 'open'> & {create: () => void};

export function LibraryIndex({layout, libraries, metadata, busy, open, create}: DirectoryProps & {
  libraries: Library[]; metadata: Record<string, string>;
}) {
  const {t, i18n} = useTranslation();
  const [sorting, setSorting] = useState(false);
  const [order, setOrder] = useState('position');
  const items = order === 'name' ? [...libraries].sort((a,b) => a.name.localeCompare(b.name,i18n.language)) : libraries;
  return <article className="library-home">
    <header className="index-title"><h1>{t('libraries')}</h1><span>{items.length}</span>
      <button className="icon-button" aria-label={t('sortLibraries')} aria-expanded={sorting} onClick={() => setSorting(!sorting)}><Icon name="tools"/></button>
    </header>
    {sorting && <label>{t('sortLibraries')}<select value={order} onChange={e => setOrder(e.target.value)}>
      <option value="position">{t('libraryOrder')}</option><option value="name">{t('alphabetical')}</option></select></label>}
    <Catalog kind="libraries" items={items} layout={layout} busy={busy} open={open} metadata={metadata}/>
    <AddButton label={t('createLibrary')} disabled={busy} onClick={create}/>
  </article>;
}

export function LibraryCollections({library, collections, layout, busy, open, create, summary}: DirectoryProps & {
  library: Library; collections: Collection[]; summary: () => void;
}) {
  const {t} = useTranslation();
  return <article className="library-home" aria-label={library.name}>
    <header className="index-title"><h1>{t('collections')}</h1><span>{collections.length}</span></header>
    <Catalog kind="collections" items={collections} layout={layout} busy={busy} open={open}/>
    <button onClick={summary} disabled={busy}>{t('librarySummary')} <Icon name="chevron"/></button>
    <AddButton label={t('createCollection')} disabled={busy} onClick={create}/>
  </article>;
}

export function EntryCard({api,row,fields,primaryId,group,renderValue}: {
  api: Repository; row: EntryListItem; fields: Field[]; primaryId: string; group?: ReactNode;
  renderValue: (field: Field) => ReactNode;
}) {
  const {t} = useTranslation();
  const image = fields.find(f => f.type === 'image' && fileIds(row.data[f.id]).length);
  const visible = fields.filter(f => f.id !== primaryId && !['secret','image','file'].includes(f.type) && (row.data[f.id] != null || row.computed?.[f.id] != null));
  const metadata = visible.filter(field => ['select', 'multiselect', 'duration', 'date', 'time'].includes(field.type));
  const excerpts = visible.filter(field => !metadata.includes(field));
  return <span className="entry-card">
    {image && <AttachmentThumbnail api={api} ownerId={row.id} id={fileIds(row.data[image.id])[0]!}/>}
    <span className="entry-copy"><strong className="entry-primary">{row.title || t('unset')}</strong>
      {(group || metadata.length > 0) && <span className="card-meta">{group}
        {metadata.map(field => field.type === 'select' || field.type === 'multiselect'
          ? <span key={field.id} className="tag" data-tone={choiceTone(choiceConfig(field).options?.find(option => option.id === row.data[field.id]))}>{renderValue(field)}</span>
          : <span key={field.id}><Icon name={field.type === 'date' ? 'calendar' : 'clock'}/>{renderValue(field)}</span>)}
      </span>}
      {excerpts.map(field => <small key={field.id}>{renderValue(field)}</small>)}
    </span>
  </span>;
}
