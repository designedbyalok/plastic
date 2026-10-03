import { mkdir, readFile, writeFile } from 'node:fs/promises';
const source = 'plugins/figma-reference-export';
const output = `${source}/dist`;
await mkdir(output, { recursive: true });
for (const name of ['code', 'ui']) {
  const bundle = await Bun.build({ entrypoints: [`${source}/${name}.ts`], target: 'browser', format: 'iife', minify: true });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  const js = await bundle.outputs[0].text();
  if (name === 'code') await writeFile(`${output}/code.js`, js);
  else {
    const html = await readFile(`${source}/ui.html`, 'utf8');
    await writeFile(`${output}/ui.html`, html.replace('<!-- BUNDLED_SCRIPT -->', `<script>${js.replaceAll('</script', '<\\/script')}</script>`));
  }
}
const manifest = JSON.parse(await readFile(`${source}/manifest.json`, 'utf8'));
if (process.env.PLASTIC_FIGMA_PLUGIN_ID) manifest.id = process.env.PLASTIC_FIGMA_PLUGIN_ID;
await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built local plugin: ${output}/manifest.json`);
