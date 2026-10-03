/**
 * Opening a file through its shared link (/file/<id>?preview=<preview id>). Plastic is
 * invite-only, so these need a session (any account); the preview id is the key to one file.
 * Everything here except comments is read-only: only GET (and the WebSocket upgrade, itself a GET) is
 * accepted, and only the file's current revisions are served, not its history.
 *
 *   GET /api/shared/<preview>                      → { id, title, owner: { name }, owned, files: { name: version } }
 *   GET /api/shared/<preview>/files/<name>?v=…     → the file at its current version
 *   GET /api/shared/<preview>/assets/<name>        → an image of the file
 *   GET /api/shared/<preview>/live?client=<id>     WebSocket: presence and cursor chat in the file's
 *                                                  room, and its owner's saves as they happen (live.ts)
 *   *   /api/shared/<preview>/comments/…           comments, which viewers can leave too (comments.ts)
 */
import type { Env } from './env.ts';
import { CLIENT_ID, room, withPeer } from './live.ts';
import { PREVIEW_ID } from './previews.ts';
import { handleComments } from './comments.ts';
import { ASSET_NAME, FILE_NAME, REVISION, backfill, projectPrefix, serveAsset, serveFile, type Member, type Row } from './projects.ts';
import { participantFor } from '../src/editor/presenceProtocol.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const error = (status: number, message: string) => json({ error: message }, status);

interface SharedRow extends Row {
  owner_id: string;
  owner_name: string | null;
}

async function sharedRow(env: Env, previewId: string): Promise<SharedRow | null> {
  if (!PREVIEW_ID.test(previewId)) return null;
  return env.DB.prepare(
    'select p.owner_id, p.id, p.title, p.updated_at, p.files, u.name as owner_name from project p join "user" u on u.id = p.owner_id where p.preview_id = ? and p.archived_at is null',
  )
    .bind(previewId)
    .first<SharedRow>();
}

export async function handleShared(request: Request, env: Env, user: Member, path: string[]): Promise<Response> {
  const row = await sharedRow(env, path[0] ?? '');
  if (!row) return error(404, 'This link doesn’t open a file. Ask its owner for a new link.');
  // Anyone who can view a file can comment on it, as in Figma; the comment is theirs.
  if (path[1] === 'comments') return handleComments(request, env, row.owner_id, row.id, user.id, path.slice(2));
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'This file is view-only.');
  const owned = row.owner_id === user.id;
  const prefix = projectPrefix(row.owner_id, row.id);
  const versions = await backfill(env, row.owner_id, row);

  if (path.length === 1) {
    return json({ id: row.id, title: row.title, owner: { name: row.owner_name ?? '' }, owned, files: versions });
  }

  if (path.length === 3 && path[1] === 'files') {
    const name = path[2]!;
    const current = versions[name];
    if (!FILE_NAME.test(name) || !current) return error(404, 'Not found.');
    const requested = new URL(request.url).searchParams.get('v');
    if (requested !== null && !REVISION.test(requested)) return error(400, 'Invalid revision.');
    // Only what the file is now: earlier revisions may hold things the owner has since removed.
    if (requested !== null && requested !== current) return error(404, 'No such revision.');
    return serveFile(env, prefix, name, current, requested !== null);
  }

  if (path.length === 3 && path[1] === 'assets') {
    const name = path[2]!;
    if (!ASSET_NAME.test(name)) return error(404, 'Not found.');
    return serveAsset(env, prefix, name);
  }

  if (path.length === 2 && path[1] === 'live') {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return error(426, 'Expected a WebSocket.');
    const client = new URL(request.url).searchParams.get('client') ?? '';
    if (!CLIENT_ID.test(client)) return error(400, 'Invalid client.');
    const peer = participantFor(client, user, owned ? 'owner' : 'viewer');
    return room(env, row.owner_id, row.id).fetch(withPeer(request, peer));
  }

  return error(404, 'Not found.');
}
