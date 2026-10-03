/** Sections driven by element semantics: identity, content, behavior, table structure. */
import { Minus, Plus, Unlink, X } from 'lucide-react';
import { useState } from 'react';
import { isValidClassName } from '../../document/css.ts';
import { detachClass, renameClass, setAttribute, setSelectOptions, setTag, setText } from '../../document/ops.ts';
import { addTableColumn, addTableRow, removeTableColumn, removeTableRow, tableShape } from '../../document/table.ts';
import { closestElement, elementChildren, nodesWithClass, textChildren, textContent } from '../../document/tree.ts';
import type { DesignDocument, ElementNode } from '../../document/types.ts';
import { elementSpec, kindLabel, swappableTags, type AttrGroup, type AttrSpec } from '../../elements/registry.ts';
import { useEditor } from '../../editor/store.ts';
import { Checkbox, LabeledRow, Row, Section, Select, TextInput } from './fields.tsx';

const apply = (label: string, recipe: (doc: DesignDocument) => DesignDocument, coalesce?: string) =>
  useEditor.getState().apply(label, recipe, coalesce ? { coalesce } : {});

/** What the element is: its name, its tag (semantics) and the class its styles live in. */
export function ElementSection({ el }: { el: ElementNode }) {
  const doc = useEditor((s) => s.doc);
  const primary = el.classes[0];
  const users = primary ? nodesWithClass(doc, primary).length : 0;
  const [classDraft, setClassDraft] = useState<string | null>(null);
  const classValid = classDraft === null || isValidClassName(classDraft);
  const tags = swappableTags(el.tag);
  const semantic = attrsIn(el, 'semantics');

  return (
    <Section title={kindLabel(el)} aside={<code className="insp-tag">&lt;{el.tag}&gt;</code>}>
      <Row>
        <span className="insp-field">
          <input
            className={`insp-input is-mono has-prefix${classValid ? '' : ' is-invalid'}`}
            aria-label="Class name"
            value={classDraft ?? primary ?? ''}
            placeholder="added on first style edit"
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
          <span className="insp-prefix">.</span>
        </span>
        {users > 1 && (
          <button type="button" className="insp-chip" title="This class is shared. Give this element its own copy." onClick={() => apply('Detach class', (d) => detachClass(d, el.id))}>
            <Unlink size={11} /> {users}
          </button>
        )}
      </Row>
      {tags.length > 1 && (
        <LabeledRow label="Tag" hint="The HTML element. Changing it changes meaning, not just looks.">
          <Select
            ariaLabel="Tag"
            mono
            value={el.tag}
            options={tags.map((t) => ({ value: t, label: `<${t}>  ${elementSpec(t).label}` }))}
            onChange={(t) => apply('Change tag', (d) => setTag(d, el.id, t))}
          />
        </LabeledRow>
      )}
      {semantic.map((a) => (
        <AttrControl key={a.name} el={el} spec={a} />
      ))}
    </Section>
  );
}

function AttrControl({ el, spec }: { el: ElementNode; spec: AttrSpec }) {
  const value = el.attrs[spec.name];
  const set = (v: string | null) => apply(`Set ${spec.name}`, (d) => setAttribute(d, el.id, spec.name, v), `attr:${el.id}:${spec.name}`);
  if (spec.kind === 'boolean') {
    return (
      <Row>
        <Checkbox checked={value !== undefined} onChange={(on) => set(on ? '' : null)} label={spec.label} />
      </Row>
    );
  }
  return (
    <LabeledRow label={spec.label} hint={spec.name}>
      {spec.kind === 'enum' ? (
        <Select ariaLabel={spec.label} value={value ?? ''} placeholder="—" options={spec.options ?? []} onChange={(v) => set(v || null)} />
      ) : (
        <TextInput
          ariaLabel={spec.label}
          value={value ?? ''}
          placeholder={spec.placeholder}
          // alt="" is meaningful (decorative image), so an empty alt is kept rather than removed.
          onChange={(v) => set(v === '' && spec.name !== 'alt' ? null : v)}
        />
      )}
    </LabeledRow>
  );
}

function attrsIn(el: ElementNode, group: AttrGroup): AttrSpec[] {
  return elementSpec(el.tag).attrs.filter((a) => a.group === group && (!a.when || a.when(el.attrs)));
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
        <Row>
          <TextInput multiline ariaLabel={el.tag === 'textarea' ? 'Value' : 'Text'} value={firstText} onChange={(v) => apply('Edit text', (d) => setText(d, el.id, v), `text:${el.id}`)} />
        </Row>
      )}
      {attrs.map((a) => (
        <AttrControl key={a.name} el={el} spec={a} />
      ))}
      {el.tag === 'img' && <ImageUpload el={el} />}
      {el.tag === 'select' && (
        <>
          <Row>
            <TextInput
              multiline
              ariaLabel="Options, one per line"
              value={options.map((o) => textContent(doc, o.id)).join('\n')}
              onChange={(v) => apply('Edit options', (d) => setSelectOptions(d, el.id, v.split('\n')), `options:${el.id}`)}
            />
          </Row>
          <LabeledRow label="Selected">
            <Select
              ariaLabel="Selected option"
              value={options.find((o) => o.attrs.selected !== undefined)?.id ?? ''}
              placeholder="(first)"
              options={options.map((o) => ({ value: o.id, label: textContent(doc, o.id) }))}
              onChange={(id) => apply('Select option', (d) => options.reduce((acc, o) => setAttribute(acc, o.id, 'selected', o.id === id ? '' : null), d))}
            />
          </LabeledRow>
        </>
      )}
    </Section>
  );
}

function ImageUpload({ el }: { el: ElementNode }) {
  return (
    <Row>
      <label className="insp-button insp-file" title="Embeds the image as a data URL. Asset folders come later.">
        Choose Image…
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => apply('Set image', (d) => setAttribute(d, el.id, 'src', String(reader.result)));
            reader.readAsDataURL(file);
          }}
        />
      </label>
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
    <LabeledRow label={label}>
      <div className="insp-stepper">
        <button type="button" className="icon-button" aria-label={`Remove ${label.toLowerCase()}`} onClick={remove}>
          <Minus size={12} />
        </button>
        <span className="insp-stepper-value">{count}</span>
        <button type="button" className="icon-button" aria-label={`Add ${label.toLowerCase()}`} onClick={add}>
          <Plus size={12} />
        </button>
      </div>
    </LabeledRow>
  );
  return (
    <Section
      title="Table"
      aside={table.id !== el.id ? <button type="button" className="insp-link" onClick={() => useEditor.getState().select([table.id])}>Select Table</button> : undefined}
    >
      {counter('Rows', shape.bodyRows.length, () => apply('Add row', (d) => addTableRow(d, table.id)), () => apply('Remove row', (d) => removeTableRow(d, table.id)))}
      {counter('Columns', shape.columns, () => apply('Add column', (d) => addTableColumn(d, table.id)), () => apply('Remove column', (d) => removeTableColumn(d, table.id)))}
    </Section>
  );
}

export function AttributesSection({ el }: { el: ElementNode }) {
  const [open, setOpen] = useState(false);
  const [name, setNameDraft] = useState('');
  const set = (attr: string, v: string | null) => apply(`Set ${attr}`, (d) => setAttribute(d, el.id, attr, v), `attr:${el.id}:${attr}`);
  return (
    <Section
      title={
        <button type="button" className="insp-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
          Attributes <span className="insp-count">{Object.keys(el.attrs).length}</span>
        </button>
      }
      empty={!open}
    >
      {Object.entries(el.attrs).map(([attr, value]) => (
        <div key={attr} className="insp-row insp-raw">
          <code className="insp-raw-key">{attr}</code>
          <TextInput mono value={value} onChange={(v) => set(attr, v)} ariaLabel={attr} />
          <button type="button" className="icon-button" aria-label={`Remove ${attr}`} onClick={() => set(attr, null)}>
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="insp-row">
        <input
          className="insp-input is-mono"
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
