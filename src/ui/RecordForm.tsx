import { LayoutRowsView } from './LayoutRowsView';
import { relationIds } from '../core/relations';
import { AttachmentList, fileSource, useFileSize } from './AttachmentList';
import { fileIds, isFile } from '../core/attachments';
import { ErrorMessage, errorKey } from './common';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, Entry, Field, RecordData, UiDefinition } from '../core/model';
import { formConfig, layoutItems } from '../core/ui-definition';
import type { Repository } from '../core/repository';
import { RelationBlock } from './RelationBlock';
import { RelationInput } from './RelationInput';
import { FieldInput } from './common';
import { CalculatedValue } from './CalculatedValue';
import { isCalculated } from '../core/calculated-fields';
export function RecordForm({
  api,
  initialData,
  collection,
  fields,
  layout,
  entry,
  save,
  cancel,
  busy,
  change,
  creating = !entry,
  pinnedData,
  attachmentOwnerId,
  registerFileClose,
}: {
  api: Repository;
  initialData?: RecordData;
  collection: Collection;
  fields: Field[];
  layout: UiDefinition;
  entry?: Entry;
  save: (data: RecordData) => void;
  cancel: () => void;
  busy: boolean;
  change?: (data: RecordData) => void;
  creating?: boolean;
  pinnedData?: RecordData;
  attachmentOwnerId?: string;
  registerFileClose?: (close: (() => Promise<void>) | null) => void;
}) {
  const { t } = useTranslation(), formatSize = useFileSize();
  const ownerId = attachmentOwnerId ?? entry?.id;
  const [fileReady, setFileReady] = useState(creating || !fields.some(field => isFile(field.type))), [uploading, setUploading] = useState(false), [fileError, setFileError] = useState<string | null>(null), [copied, setCopied] = useState(0);
  const active = useRef(true), controllers = useRef(new Set<AbortController>()), transfers = useRef(new Set<Promise<void>>());
  const blocked = busy || uploading || !fileReady;
  const items = layoutItems(layout, fields);
  const [data, setData] = useState<RecordData>(() => {
    if (entry) return { ...entry.data };
    const values: RecordData = {};
    fields.forEach((field) => {
      const config = formConfig(
        field,
        items.find((i) => i.field_id === field.id)
      );
      if (Object.hasOwn(config, 'default')) values[field.id] = config.default!;
    });
    return { ...values, ...initialData };
  });
  const currentData = useRef(data);
  const [calculated, setCalculated] = useState<{ input: RecordData; values: Entry['computed'] }>({ input: data, values: entry?.computed });
  useEffect(() => {
    if (!fields.some(field => isCalculated(field.type))) return;
    let active = true;
    const timer = setTimeout(() => {
      void api.previewFormulas(collection.id, data, ownerId).then(values => { if (active) setCalculated({ input: data, values: values as NonNullable<Entry['computed']> }); })
        .catch(error => { if (active) setCalculated({ input: data, values: Object.fromEntries(fields.filter(field => isCalculated(field.type)).map(field => [field.id, { value: null, error: errorKey(error), dynamic: false }])) }); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [api, collection.id, data, fields, ownerId]);
  useEffect(() => {
    active.current = true; const ownedControllers = controllers.current;
    if (!creating && ownerId) void api.discardAttachmentStages(ownerId).then(() => { if (active.current) setFileReady(true); }).catch(e => { if (active.current) setFileError(errorKey(e)); });
    const stop = async () => { controllers.current.forEach(controller => controller.abort()); await Promise.allSettled([...transfers.current]); if (!creating && ownerId) await api.discardAttachmentStages(ownerId); };
    registerFileClose?.(stop);
    return () => { active.current = false; ownedControllers.forEach(controller => controller.abort()); registerFileClose?.(null); };
    // A form is keyed by its owner/HLC; busy/validation updates must not reset in-flight uploads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function upload(field: Field, files: File[]) {
    if (blocked || !ownerId || !files.length) return;
    const multiple = formConfig(field).multiple === true;
    if ((!multiple && files.length > 1) || (field.type === 'image' && files.some(file => !file.type.startsWith('image/')))) { setFileError('invalidAttachment'); return; }
    const controller = new AbortController(); controllers.current.add(controller); setUploading(true); setCopied(0); setFileError(null);
    const task = (async () => {
      try {
        let total = 0;
        for (const file of files) {
          const staged = await api.stageAttachment(collection.id, ownerId, fileSource(file), count => { if (active.current) setCopied(total + count); }, controller.signal);
          if (active.current && !controller.signal.aborted) {
            const ids = multiple ? [...fileIds(currentData.current[field.id]), staged.id] : [staged.id];
            let next = { ...currentData.current, [field.id]: ids };
            if (collection.system_kind === 'inbox' && !String(next[collection.incoming_field_id] ?? '').trim()) next = { ...next, [collection.incoming_field_id]: file.name };
            currentData.current = next; setData(next); change?.(next);
          }
          total += file.size;
        }
      } catch (e) { if (active.current && !controller.signal.aborted) setFileError(errorKey(e)); }
      finally { controllers.current.delete(controller); if (active.current) setUploading(false); }
    })();
    transfers.current.add(task); void task.finally(() => transfers.current.delete(task));
  }
  // Capture creation defaults for close/pause, without writing any database object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { change?.(data); }, []);
  function update(id: string, value: RecordData[string]) {
    const next = { ...currentData.current, [id]: value };
    currentData.current = next; setData(next);
    change?.(next);
  }
  return (
    <form
      onInvalidCapture={event => {
        let element = event.target as HTMLElement | null;
        while (element) { if (element instanceof HTMLDetailsElement) element.open = true; element = element.parentElement; }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (blocked) return;
        const missing = fields.find(field => isFile(field.type) && formConfig(field, items.find(item => item.field_id === field.id)).required && !fileIds(data[field.id]).length);
        if (missing) { setFileError('requiredField'); const control = e.currentTarget.querySelector<HTMLElement>('[data-attachment-field="' + missing.id + '"]'); control?.closest('details')?.setAttribute('open',''); control?.querySelector('input')?.focus(); return; }
        save(data);
      }}
    >
      {fileError && <ErrorMessage code={fileError} />}
      {uploading && <p role="status">{t('attachmentCopyProgress', { size: formatSize(copied) })}</p>}
      <LayoutRowsView definition={layout} fields={fields} label={field => collection.system_kind === 'inbox' ? t(field.id === collection.incoming_field_id ? 'inboxContent' : 'attachments') : field.name} render={item => {
            const field = fields.find((f) => f.id === item.field_id)!;
            const displayField = collection.system_kind === 'inbox' ? (field.id === collection.incoming_field_id ? { ...field, name: t('inboxContent'), type: 'markdown' } : { ...field, name: t('attachments') }) : field;
            const config = formConfig(field, item),
              required = config.required || field.id === collection.primary_field_id;
            return (
              <div key={field.id}>
                <div className="form-field">
                  {!item.collapsed && displayField.name}
                  {required && <span aria-hidden="true"> *</span>}
                  {isFile(field.type) && ownerId ? <div data-attachment-field={field.id}>
                    <input type="file" aria-label={displayField.name === 'attachments' ? t('attachments') : displayField.name} aria-required={required} accept={field.type === 'image' ? 'image/*' : undefined}
                      multiple={config.multiple === true} disabled={blocked} onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; upload(field, files); }} />
                    <AttachmentList api={api} ownerId={ownerId} ids={fileIds(data[field.id])} busy={blocked} removeReference={id => update(field.id, fileIds(currentData.current[field.id]).filter(value => value !== id))} />
                  </div> : isCalculated(field.type) ? <CalculatedValue field={field} value={calculated.input === data ? calculated.values?.[field.id] : undefined} /> : field.type === 'backlink' ? (
                    entry ? (
                      <RelationBlock api={api} field={field} entry={entry} busy={blocked} readOnly />
                    ) : (
                      <small>{t('relationDerivedHint')}</small>
                    )
                  ) : field.type === 'relation' ? (
                    <RelationInput
                      pinnedIds={relationIds(pinnedData?.[field.id])}
                      api={api}
                      field={displayField}
                      value={data[field.id]}
                      disabled={blocked}
                      change={(value) => update(field.id, value)}
                    />
                  ) : (
                    <FieldInput
                      field={displayField}
                      value={data[field.id]}
                      disabled={blocked}
                      required={required}
                      change={(value) => update(field.id, value)}
                    />
                  )}
                </div>
                {config.hint && <small>{config.hint}</small>}
              </div>
            );
          }} />
      <div className="actions">
        <button type="button" disabled={busy} onClick={cancel}>
          {t(creating ? 'close' : 'cancel')}
        </button>
        <button className="primary" disabled={blocked}>
          {t('save')}
        </button>
      </div>
    </form>
  );
}
