/** Run in a real browser (CSS.registerProperty/cascade are not implemented by jsdom).
 * From a Vite browser tab: import('/tests/browser/provenance-cases.ts').then(m => m.runProvenanceBrowserChecks()).
 */
import { styleProvenance } from '../../src/canvas/provenance.ts';
import { parseStyleSheet, parseTokenSheet, serializeStyleSheet } from '../../src/document/css.ts';
import { emptyDocument } from '../../src/document/factory.ts';

export function runProvenanceBrowserChecks(): string[] {
  const checks: string[] = [];
  const check = (
    name: string,
    css: string,
    html: string,
    prop: string,
    expected: {
      selector?: string;
      value?: string;
      file?: string;
      computed?: string;
      inherited?: string;
      tokenValues?: string[];
    },
    tokens = '',
  ) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.style.cssText = 'position:fixed;left:-10000px;width:500px;height:200px';
    document.body.appendChild(frame);
    try {
      const owner = frame.contentDocument!;
      owner.open();
      owner.write('<!doctype html><html><head></head><body></body></html>');
      owner.close();
      const tokenStyle = owner.createElement('style'),
        style = owner.createElement('style');
      tokenStyle.dataset.plasticSource = 'tokens.css';
      tokenStyle.textContent = tokens;
      style.dataset.plasticSource = 'styles.css';
      style.textContent = css;
      owner.head.append(tokenStyle, style);
      owner.body.innerHTML = html;
      const element = owner.querySelector<HTMLElement>('.a')!;
      const before = owner.documentElement.outerHTML;
      const doc = { ...emptyDocument('Checks'), styles: parseStyleSheet(css), tokens: parseTokenSheet(tokens) };
      const original = serializeStyleSheet(doc.styles);
      const result = styleProvenance(doc, element, prop);
      const assert = (condition: boolean, message: string) => {
        if (!condition) throw new Error(`${name}: ${message}; ${JSON.stringify(result)}`);
      };
      if (expected.selector !== undefined) assert(result.source?.selector === expected.selector, 'wrong selector');
      if (expected.value !== undefined) assert(result.source?.value === expected.value, 'wrong declared value');
      if (expected.file !== undefined) assert(result.source?.file === expected.file, 'wrong file');
      if (expected.computed !== undefined) assert(result.computed === expected.computed, 'wrong computed value');
      if (expected.inherited !== undefined)
        assert((result.source?.inheritedFrom ?? '') === expected.inherited, 'wrong inheritance origin');
      if (expected.tokenValues)
        assert(
          JSON.stringify(result.tokens.map((t) => t.computed)) === JSON.stringify(expected.tokenValues),
          'wrong variable scope',
        );
      if (!expected.selector && !expected.file) assert(result.source === null, 'expected no authored source');
      assert(owner.documentElement.outerHTML === before, 'probe changed live markup or left a diagnostic behind');
      assert(serializeStyleSheet(doc.styles) === original, 'probe changed saved CSS');
      checks.push(name);
    } finally {
      frame.remove();
    }
  };
  check('later class rule', '.a{color:red}.a{color:blue}', '<p class="a">Text</p>', 'color', {
    selector: '.a',
    value: 'blue',
    computed: 'rgb(0, 0, 255)',
  });
  check('selector specificity', '#target{color:red}.a{color:blue}', '<p id="target" class="a">Text</p>', 'color', {
    selector: '#target',
    value: 'red',
  });
  check(
    'where has zero specificity',
    '.a{color:red}:where(#target){color:blue}',
    '<p id="target" class="a">Text</p>',
    'color',
    { selector: '.a', value: 'red' },
  );
  check(
    'important beats inline normal',
    '.a{color:blue!important}',
    '<p class="a" style="color:red; padding: 2px">Text</p>',
    'color',
    { selector: '.a', value: 'blue' },
  );
  check(
    'inline important',
    '.a{color:blue!important}',
    '<p class="a" style="color:red!important; padding: 2px">Text</p>',
    'color',
    { file: 'HTML inline style', value: 'red' },
  );
  check('inheritance', '.parent{color:red}', '<div class="parent"><p class="a">Text</p></div>', 'color', {
    selector: '.parent',
    inherited: 'div.parent',
  });
  check(
    'same rule is directly applied',
    '.parent,.a{color:red}',
    '<div class="parent"><p class="a">Text</p></div>',
    'color',
    { selector: '.parent,.a', inherited: '' },
  );
  check(
    'non-inherited background',
    '.parent{background-color:red}',
    '<div class="parent"><p class="a">Text</p></div>',
    'background-color',
    { computed: 'rgba(0, 0, 0, 0)' },
  );
  check(
    'shorthand important',
    '.a{padding:10px!important;padding-left:30px}',
    '<p class="a">Text</p>',
    'padding-left',
    { selector: '.a', value: '10px', computed: '10px' },
  );
  check('inline shorthand', '', '<p class="a" style="padding:10px 20px">Text</p>', 'padding-left', {
    file: 'HTML inline style',
    value: '10px 20px',
    computed: '20px',
  });
  check(
    'active media',
    '.a{color:red}@media(max-width:600px){.a{color:blue}}@media(max-width:300px){.a{color:green}}',
    '<p class="a">Text</p>',
    'color',
    { selector: '.a', value: 'blue' },
  );
  check(
    'named layers',
    '@layer base,theme; @layer base{.a{color:red}} @layer theme{.a{color:blue}}',
    '<p class="a">Text</p>',
    'color',
    { selector: '.a', value: 'blue' },
  );
  check(
    'important reverses layer order',
    '@layer base,theme; @layer base{.a{color:red!important}} @layer theme{.a{color:blue!important}}',
    '<p class="a">Text</p>',
    'color',
    { selector: '.a', value: 'red' },
  );
  check(
    'revert-layer',
    '@layer base,theme; @layer base{.a{color:red}} @layer theme{.a{color:revert-layer}}',
    '<p class="a">Text</p>',
    'color',
    { selector: '.a', value: 'red' },
  );
  check(
    'token theme override',
    '.a{color:var(--brand)}[data-theme="dark"]{--brand:blue}',
    '<div data-theme="dark"><p class="a">Text</p></div>',
    'color',
    { selector: '.a', tokenValues: ['blue'] },
    ':root{--brand:red}',
  );
  check(
    'aliases resolve where defined',
    '.a{color:var(--alias)}.parent{--brand:blue}',
    '<div class="parent"><p class="a">Text</p></div>',
    'color',
    { selector: '.a', computed: 'rgb(255, 0, 0)', tokenValues: ['red', 'red'] },
    ':root{--brand:red;--alias:var(--brand)}',
  );
  return checks;
}
