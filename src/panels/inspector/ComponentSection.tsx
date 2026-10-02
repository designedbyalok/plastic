import {
  canDefineComponent,
  componentOwner,
  defineComponent,
  detachComponent,
  instantiateComponent,
  renameComponent,
  synchronizeComponents,
} from '../../document/components.ts';
import { layerName } from '../../elements/registry.ts';
import { useEditor } from '../../editor/store.ts';
import type { ElementNode, NodeId } from '../../document/types.ts';
import { pageOf } from '../../document/tree.ts';
import { Row, Section, TextInput } from './fields.tsx';

function insert(source: NodeId, beside?: NodeId) {
  const state = useEditor.getState();
  let id: NodeId | null = null;
  state.apply('Insert component instance', (doc) => {
    const result = instantiateComponent(
      doc,
      source,
      beside ? (pageOf(doc, beside)?.file ?? state.activePage) : state.activePage,
      beside,
    );
    id = result.id;
    return result.doc;
  });
  if (id) useEditor.getState().select([id]);
}

export function ComponentSection({ el }: { el: ElementNode }) {
  const doc = useEditor((s) => s.doc);
  const owner = componentOwner(doc, el.id);
  const link = owner ? doc.components?.instances[owner] : undefined;
  const source = link?.source ?? owner;
  const name = source ? doc.components?.definitions[source] : null;
  if (!owner && !canDefineComponent(doc, el.id)) return null;
  return (
    <Section title={link ? 'Component instance' : owner ? 'Main component' : 'Component'}>
      {!owner ? (
        <Row>
          <button
            type="button"
            className="insp-button"
            onClick={() =>
              useEditor.getState().apply('Create component', (d) => defineComponent(d, el.id, layerName(d, el.id)))
            }
          >
            Create component
          </button>
        </Row>
      ) : (
        <>
          <Row>
            {link || owner !== el.id ? (
              <span className="insp-source-value">{name}</span>
            ) : (
              <TextInput
                ariaLabel="Component name"
                value={name ?? ''}
                onChange={(value) =>
                  useEditor
                    .getState()
                    .apply('Rename component', (d) => renameComponent(d, owner, value), {
                      coalesce: `component:${owner}`,
                    })
                }
              />
            )}
          </Row>
          <p className="insp-source-note">
            Main structure updates automatically. Instance text and attribute edits stay local. CSS classes remain
            shared.
          </p>
          <Row>
            <button type="button" className="insp-button" onClick={() => insert(source!, owner!)}>
              Insert instance
            </button>
          </Row>
          {link && (
            <Row>
              <button
                type="button"
                className="insp-button"
                onClick={() => {
                  const state = useEditor.getState();
                  const page = pageOf(state.doc, source!);
                  if (page) state.setActivePage(page.file);
                  state.select([source!]);
                }}
              >
                Go to main component
              </button>
            </Row>
          )}
          {link && (
            <Row>
              <button
                type="button"
                className="insp-button"
                onClick={() =>
                  useEditor.getState().apply('Reset instance overrides', (d) => synchronizeComponents(d, owner))
                }
              >
                Reset instance overrides
              </button>
            </Row>
          )}
          {owner !== el.id && (
            <Row>
              <button type="button" className="insp-button" onClick={() => useEditor.getState().select([owner])}>
                Select component root
              </button>
            </Row>
          )}
          <Row>
            <button
              type="button"
              className="insp-button"
              onClick={() =>
                useEditor
                  .getState()
                  .apply(link ? 'Detach instance' : 'Remove component link', (d) => detachComponent(d, owner))
              }
            >
              {link ? 'Detach instance' : 'Remove component link'}
            </button>
          </Row>
        </>
      )}
    </Section>
  );
}

export function ComponentLibrarySection() {
  const definitions = useEditor((s) => s.doc.components?.definitions);
  if (!definitions || !Object.keys(definitions).length) return null;
  return (
    <Section title="Components">
      {Object.entries(definitions).map(([id, name]) => (
        <Row key={id}>
          <button
            type="button"
            className="insp-button"
            onClick={() => insert(id)}
            title={`Insert ${name} on this page`}
          >
            {name}
          </button>
        </Row>
      ))}
    </Section>
  );
}
