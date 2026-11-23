import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, EntryListItem, Field, Library } from '../core/model';
import { Catalog } from './Catalog';
import { Icon } from './Icon';
import { AttachmentThumbnail } from './AttachmentThumbnail';
import { fileIds } from '../core/attachments';
import type { Repository } from '../core/repository';

/** The home is a real destination, not the old browse toolbar with a new skin.
 * Catalog data and actions still come entirely from the existing Repository. */
export function LibraryIndex({ libraries, metadata, busy, open, create }: {
  libraries: Library[]; metadata: Record<string, string>; busy: boolean;
  open: (id: string) => void; create: () => void;
}) {
  const { t } = useTranslation();
  return <section className="reference-library-index" aria-labelledby="reference-libraries-title">
    <header className="reference-index-heading">
      <h1 id="reference-libraries-title">{t('libraries')} <span className="reference-count">{libraries.length}</span></h1>
    </header>
    <Catalog kind="libraries" items={libraries} layout="list" metadata={metadata} busy={busy} open={open} />
    <button className="reference-fab reference-library-fab" type="button" aria-label={t('createLibrary')} title={t('createLibrary')} disabled={busy} onClick={create}><Icon name="capture" /></button>
  </section>;
}

/** A library presents its collections as calm navigation rows, not configuration. */
export function LibraryCollections({ library, collections, busy, open, create, summary }: {
  library: Library; collections: Collection[]; busy: boolean;
  open: (id: string) => void; create: () => void; summary: () => void;
}) {
  const { t } = useTranslation();
  return <section className="reference-collections-index" aria-labelledby="reference-collections-title">
    <div className="reference-collections-heading">
      <h1 id="reference-collections-title">{library.name}</h1>
      <p>{t('collections')} · {collections.length}</p>
    </div>
    <Catalog kind="collections" items={collections} layout="list" busy={busy} open={open} />
    <button type="button" className="reference-summary-link" disabled={busy} onClick={summary}>{t('librarySummary')} <Icon name="chevron" /></button>
    <button className="reference-fab reference-collection-fab" type="button" aria-label={t('createCollection')} title={t('createCollection')} disabled={busy} onClick={create}><Icon name="capture" /></button>
  </section>;
}

/** Presentation-only card for a generic record. No recipe/task-specific data model. */
export function ReferenceRecordPreview({ api, row, fields, primaryId, label, renderValue, locale, group }: {
  api: Repository; row: EntryListItem; fields: Field[]; primaryId: string;
  label: (field: Field) => ReactNode; renderValue: (field: Field) => ReactNode;
  locale: string; group?: ReactNode;
}) {
  const { t } = useTranslation();
  const imgField = fields.find(field => field.type === 'image' && fileIds(row.data[field.id]).length);
  const imageId = imgField ? fileIds(row.data[imgField.id])[0] : undefined;
  // The primary field is always the title; other fields supply a concise preview
  // of whatever layout the user configured, without hiding the full record.
  const others = fields.filter(field => field.id !== primaryId && field.type !== 'secret' && field.type !== 'image' && field.type !== 'file');
  const badge = others.find(field => ['select','multiselect'].includes(field.type) && row.data[field.id] != null);
  const preview = others.find(field => field !== badge && ['text','multiline','markdown','url','email','phone','address'].includes(field.type) && typeof row.data[field.id] === 'string' && String(row.data[field.id]).trim());
  const timeField = others.find(field => field !== badge && ['duration','time'].includes(field.type) && row.data[field.id] != null);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(row.updated_at));
  return <span className={'reference-record-preview' + (imageId ? ' has-image' : '')}>
    {imageId && <span className="reference-record-media"><AttachmentThumbnail api={api} id={imageId} ownerId={row.id} /></span>}
    <span className="reference-record-copy">
      <strong className="entry-primary reference-record-name">{row.title || t('unset')}</strong>
      {(group || badge || timeField) && <span className="reference-record-tags">
        {group && <span className="reference-record-group">{group}</span>}
        {badge && <span className="reference-record-badge" title={String(label(badge))}>{renderValue(badge)}</span>}
        {timeField && <span className="reference-record-time"><Icon name="clock" />{renderValue(timeField)}</span>}
      </span>}
      {preview && <span className="reference-record-excerpt">{renderValue(preview)}</span>}
      <span className="reference-record-timestamp">{date}</span>
    </span>
  </span>;
}
