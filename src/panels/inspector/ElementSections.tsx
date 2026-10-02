/** Sections driven by element semantics: identity, content, behavior, table structure. */
import { Minus, Plus, Unlink, X } from 'lucide-react';
import { useState } from 'react';
import { isValidClassName } from '../../document/css';
import { detachClass, renameClass, setAttribute, setName, setSelectOptions, setTag, setText } from '../../document/ops';
import { addTableColumn, addTableRow, removeTableColumn, removeTableRow, tableShape } from '../../document/table';
import { closestElement, elementChildren, nodesWithClass, textChildren, textContent } from '../../document/tree';
import type { DesignDocument, ElementNode } from '../../document/types';
import { elementSpec, kindLabel, layerName, swappableTags, type AttrGroup, type AttrSpec } from '../../elements/registry';
import { useEditor } from '../../editor/store';
import { Row, Section, TextInput } from './fields';

const apply = (label: string, recipe: (doc: DesignDocument) => DesignDocument, coalesce?: string) =>
  useEditor.getState().apply(label, recipe, coalesce ? { coalesce } : {});

export function ElementHeader({ el }: { el: ElementNode }) {
  const doc = useEditor((s) => s.doc);
  const primary = el.classes[0];
  const users = primary ? nodesWithClass(doc, primary).length : 0;
  const [classDraft, setClassDraft] = useState<string | null>(null);
  const classValid = classDraft === null || isValidClassName(classDraft);

  return (
    <div className="element-header">
      <div className="element-kind">
        <span className="element-kind-label">{kindLabel(el)}</span>
        <code className="element-tag">&lt;{el.tag}&gt;</code>
      </div>
      <TextInput
        ariaLabel="Layer name"
        value={doc.names[el.id] ?? ''}
        placeholder={layerName(doc, el.id)}
        onChange={(v) => apply('Rename layer', (d) => setName(d, el.id, v || null), `name:${el.id}`)}
      />
      <div className="class-row">
        <span className="class-dot">.</span>
        <input
          className={`text-input is-mono${classValid ? '' : ' is-invalid'}`}
          aria-label="Class name"
          value={classDraft ?? primary ?? ''}
          placeholder="class (created on first style edit)"
          spellCheck={false}
          onChange={(e) => setClassDraft(e.target.value)}
          onBlur={() => {
            if (classDraft && primary && isValidClassName(classDraft)) apply('Rename class', (d) => renameClass(d, primary, classDraft));
            setClassDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setClassDraft(null);
          }}
        />
        {users > 1 && (
          <button type="button" className="chip-button" title="This class is shared. Give this element its own copy." onClick={() => apply('Detach class', (d) => detachClass(d, el.id))}>
            <Unlink size={12} /> {users} share
          </button>
        )}
      </div>
      {el.classes.length > 1 && <div className="muted">Also: {el.classes.slice(1).map((c) => `.${c}`).join(' ')}</div>}
    </div>
  );
}

function AttrControl({ el, spec }: { el: ElementNode; spec: AttrSpec }) {
  const value = el.attrs[spec.name];
  const set = (v: string | null) => apply(`Set ${spec.name}`, (d) => setAttribute(d, el.id, spec.name, v), `attr:${el.id}:${spec.name}`);
  if (spec.kind === 'boolean') {
    return (
      <label className="check-row">
        <input type="checkbox" checked={value !== undefined} onChange={(e) => set(e.target.checked ? '' : null)} />
        <span>{spec.label}</span>
        <code className="attr-name">{spec.name}</code>
      </label>
    );
  }
  const control =
    spec.kind === 'enum' ? (
      <select className="select-input" aria-label={spec.label} value={value ?? ''} onChange={(e) => set(e.target.value || null)}>
        <option value="">—</option>
        {spec.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    ) : (
      <TextInput
        ariaLabel={spec.label}
        value={value ?? ''}
        placeholder={spec.placeholder}
        // alt="" is meaningful (decorative image), so an empty alt is kept rather than removed.
        onChange={(v) => set(v === '' && spec.name !== 'alt' ? null : v)}
      />
    );
  return (
    <Row label={spec.label} hint={spec.name}>
      {control}
    </Row>
  );
}

function attrsIn(el: ElementNode, group: AttrGroup): AttrSpec[] {
  return elementSpec(el.tag).attrs.filter((a) => a.group === group && (!a.when || a.when(el.attrs)));
}

export function SemanticsSection({ el }: { el: ElementNode }) {
  const tags = swappableTags(el.tag);
  const attrs = attrsIn(el, 'semantics');
  return (
    <Section title="Element">
      <Row label="Tag" hint="The HTML element. Changing it changes meaning, not just looks.">
        <select className="select-input is-mono" aria-label="Tag" value={el.tag} disabled={tags.length < 2} onChange={(e) => apply('Change tag', (d) => setTag(d, el.id, e.target.value))}>
          {tags.map((t) => (
            <option key={t} value={t}>
              {`<${t}>`} {elementSpec(t).label}
            </option>
          ))}
        </select>
      </Row>
      {attrs.map((a) => (
        <AttrControl key={a.name} el={el} spec={a} />
      ))}
    </Section>
  );
}

export function ContentSection({ el }: { el: ElementNode }) {
  const doc = useEditor((s) => s.doc);
  const spec = elementSpec(el.tag);
  const hasText = textChildren(doc, el).length > 0;
  const showText = (spec.editableText || hasText || el.tag === 'textarea') && el.tag !== 'select';
  const attrs = attrsIn(el, 'content');
  const options = el.tag === 'select' ? elementChildren(doc, el).filter((c) => c.tag === 'option') : [];
  if (!showText && !attrs.length && el.tag !== 'select' && el.tag !== 'img') return null;

  const firstText = textChildren(doc, el)[0]?.text ?? '';
  return (
    <Section title="Content">
      {showText && (
        <Row label={el.tag === 'textarea' ? 'Value' : 'Text'}>
          <TextInput multiline value={firstText} onChange={(v) => apply('Edit text', (d) => setText(d, el.id, v), `text:${el.id}`)} />
        </Row>
      )}
      {attrs.map((a) => (
        <AttrControl key={a.name} el={el} spec={a} />
      ))}
      {el.tag === 'img' && <ImageUpload el={el} />}
      {el.tag === 'select' && (
        <>
          <Row label="Options" hint="One option per line">
            <TextInput
              multiline
              value={options.map((o) => textContent(doc, o.id)).join('\n')}
              onChange={(v) => apply('Edit options', (d) => setSelectOptions(d, el.id, v.split('\n')), `options:${el.id}`)}
            />
          </Row>
          <Row label="Selected">
            <select
              className="select-input"
              aria-label="Selected option"
              value={options.find((o) => o.attrs.selected !== undefined)?.id ?? ''}
              onChange={(e) =>
                apply('Select option', (d) => options.reduce((acc, o) => setAttribute(acc, o.id, 'selected', o.id === e.target.value ? '' : null), d))
              }
            >
              <option value="">(first)</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {textContent(doc, o.id)}
                </option>
              ))}
            </select>
          </Row>
        </>
      )}
    </Section>
  );
}

function ImageUpload({ el }: { el: ElementNode }) {
  return (
    <Row label="File" hint="Embeds the image as a data URL. Asset folders come later.">
      <input
        type="file"
        accept="image/*"
        className="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => apply('Set image', (d) => setAttribute(d, el.id, 'src', String(reader.result)));
          reader.readAsDataURL(file);
        }}
      />
    </Row>
  );
}

export function BehaviorSection({ el }: { el: ElementNode }) {
  const attrs = attrsIn(el, 'behavior');
  if (!attrs.length) return null;
  return (
    <Section title="Behavior">
      {attrs.map((a) => (
        <AttrControl key={a.name} el={el} spec={a} />
      ))}
    </Section>
  );
}

export function TableSection({ el }: { el: ElementNode }) {
  const doc = useEditor((s) => s.doc);
  const table = closestElement(doc, el.id, (e) => e.tag === 'table');
  const shape = table ? tableShape(doc, table.id) : null;
  if (!table || !shape) return null;
  const counter = (label: string, count: number, add: () => void, remove: () => void) => (
    <Row label={label}>
      <div className="stepper">
        <button type="button" className="icon-button" aria-label={`Remove ${label.toLowerCase()}`} onClick={remove}>
          <Minus size={12} />
        </button>
        <span className="stepper-value">{count}</span>
        <button type="button" className="icon-button" aria-label={`Add ${label.toLowerCase()}`} onClick={add}>
          <Plus size={12} />
        </button>
      </div>
    </Row>
  );
  return (
    <Section
      title="Table"
      aside={table.id !== el.id ? <button type="button" className="link-button" onClick={() => useEditor.getState().select([table.id])}>Select table</button> : undefined}
    >
      {counter('Body rows', shape.bodyRows.length, () => apply('Add row', (d) => addTableRow(d, table.id)), () => apply('Remove row', (d) => removeTableRow(d, table.id)))}
      {counter('Columns', shape.columns, () => apply('Add column', (d) => addTableColumn(d, table.id)), () => apply('Remove column', (d) => removeTableColumn(d, table.id)))}
      <div className="muted">Header rows: {shape.headerRows.length}. Cells share classes, so styling one cell styles its column type.</div>
    </Section>
  );
}

export function AttributesSection({ el }: { el: ElementNode }) {
  const [name, setNameDraft] = useState('');
  const set = (attr: string, v: string | null) => apply(`Set ${attr}`, (d) => setAttribute(d, el.id, attr, v), `attr:${el.id}:${attr}`);
  return (
    <Section title="All attributes" defaultOpen={false}>
      {Object.entries(el.attrs).map(([attr, value]) => (
        <div key={attr} className="raw-row">
          <code className="raw-key">{attr}</code>
          <TextInput mono value={value} onChange={(v) => set(attr, v)} ariaLabel={attr} />
          <button type="button" className="icon-button" aria-label={`Remove ${attr}`} onClick={() => set(attr, null)}>
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="raw-row">
        <input
          className="text-input is-mono"
          placeholder="add attribute…"
          value={name}
          aria-label="New attribute name"
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && /^[a-z][\w:-]*$/i.test(name)) {
              set(name, '');
              setNameDraft('');
            }
          }}
        />
      </div>
    </Section>
  );
}
