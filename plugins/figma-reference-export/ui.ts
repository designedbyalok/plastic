import { referenceBundle } from './bundle.ts';
import type { CapturePacket } from './capture.ts';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element('status');
const capture = element<HTMLButtonElement>('capture');
const download = element<HTMLButtonElement>('download');
const input = element<HTMLInputElement>('source');
let packet: CapturePacket | null = null;
let source: File | null = null;
let count = 0;
let invalid = 0;
let busy = false;
function buttons() {
  input.disabled = busy;
  element<HTMLInputElement>('name').disabled = busy;
  capture.disabled = busy || !count || !!invalid;
  download.disabled = busy || !packet || !source;
}
input.onchange = () => {
  source = input.files?.[0] ?? null;
  element('source-note').textContent = source ? `${source.name} · ${(source.size / 1024 / 1024).toFixed(1)} MB` : 'Save a local copy from this file, then attach it here.';
  buttons();
};
capture.onclick = () => {
  busy = true; packet = null; buttons();
  status.textContent = 'Capturing Figma References…';
  parent.postMessage({ pluginMessage: { type: 'capture' } }, '*');
};
window.onmessage = (event: MessageEvent) => {
  if (event.source !== parent) return;
  const message = event.data?.pluginMessage;
  if (!message) return;
  if (message.type === 'selection') {
    count = message.count; invalid = message.invalid;
    if (!busy) packet = null;
    element('selection').textContent = invalid ? 'Select Only Top-Level Frames or Components' : `${count} ${count === 1 ? 'Frame' : 'Frames'} Selected`;
  } else if (message.type === 'progress') status.textContent = `Capturing ${Math.min(message.done + 1, message.total)} of ${message.total}: ${message.name}`;
  else if (message.type === 'captured') {
    const captured = message.packet as CapturePacket;
    packet = { ...captured, frames: captured.frames.map((f) => ({ ...f, png: new Uint8Array(f.png) })) };
    busy = false;
    status.textContent = `${packet!.frames.length} References Ready. Attach the Matching Local Copy to Download.`;
    const fonts = [...new Set(packet!.frames.flatMap((f) => f.fonts.map((font) => `${font.family} ${font.style}`)))];
    element('fonts').textContent = fonts.length ? `Fonts Used: ${fonts.join(', ')}. Font files are not included.` : 'No Text Fonts Used.';
  } else if (message.type === 'error') { busy = false; status.textContent = message.message; }
  buttons();
};
download.onclick = async () => {
  if (!packet || !source || busy) return;
  busy = true; buttons(); status.textContent = 'Packaging Reference Bundle…';
  try {
    const id = element<HTMLInputElement>('name').value.trim();
    const bytes = await referenceBundle(packet, new Uint8Array(await source.arrayBuffer()), id);
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }));
    const link = document.createElement('a'); link.href = url; link.download = `${id}-figma-reference.zip`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = 'Reference Bundle Downloaded.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could Not Create the Bundle.'; }
  finally { busy = false; buttons(); }
};
buttons();
