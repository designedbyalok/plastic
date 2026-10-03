/** Publish approved templates using the authenticated official Resend CLI. No emails are sent. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emailTemplates } from '../worker/generated/email-templates.ts';

const manifest = JSON.parse(readFileSync(new URL('../emails/manifest.json', import.meta.url), 'utf8'));
if (manifest.status !== 'approved') throw new Error('Email designs must be approved before publishing');
const referencesURL = new URL('../emails/resend-templates.json', import.meta.url);
let references = {};
try {
  references = JSON.parse(readFileSync(referencesURL, 'utf8'));
} catch {
  /* First publication. */
}
const temporary = mkdtempSync(join(tmpdir(), 'plastic-resend-'));
function cli(args) {
  const result = process.env.RESEND_CLI
    ? execFileSync(process.execPath, [process.env.RESEND_CLI, ...args, '--json'], { encoding: 'utf8' })
    : execFileSync('npm', ['exec', '--yes', '--package=resend-cli@2.23.0', '--', 'resend', ...args, '--json'], { encoding: 'utf8' });
  return JSON.parse(result);
}
try {
  for (const [id, template] of Object.entries(emailTemplates)) {
    const variable = (key) => `PLASTIC_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
    const variables = [...new Set([...template.html.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((key) => key !== 'assetOrigin'))];
    const convert = (text) =>
      text.replace(/\{\{(\w+)\}\}/g, (_, key) => (key === 'assetOrigin' ? 'https://useplastic.app' : `{{{${variable(key)}}}}`));
    const htmlPath = join(temporary, `${id}.html`),
      textPath = join(temporary, `${id}.txt`);
    writeFileSync(htmlPath, convert(template.html));
    writeFileSync(textPath, convert(template.text));
    const ref = references[id];
    const args = [
      ref ? 'update' : 'create',
      ...(ref ? [ref.id] : []),
      '--name',
      `Plastic • ${id}`,
      '--alias',
      `plastic-${id}`,
      '--from',
      manifest.sender,
      '--subject',
      template.subject,
      '--html-file',
      htmlPath,
      '--text-file',
      textPath,
      ...(variables.length ? ['--var', ...variables.map((key) => `${variable(key)}:string${key === 'name' ? ':there' : ''}`)] : []),
    ];
    const result = cli(['templates', ...args]);
    references[id] = { id: result.id, alias: `plastic-${id}`, status: 'draft' };
    writeFileSync(referencesURL, JSON.stringify(references, null, 2) + '\n');
    cli(['templates', 'publish', result.id]);
    references[id].status = 'published';
    writeFileSync(referencesURL, JSON.stringify(references, null, 2) + '\n');
    console.log(`Published ${id}`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
