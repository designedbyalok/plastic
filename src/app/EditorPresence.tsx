import { useEffect, useState, type CSSProperties } from 'react';
import { Bot, UserRound } from 'lucide-react';
import { Blocks } from 'loading-dev';
import { useAccount } from '../auth/AuthGate.tsx';
import { initials } from '../home/Avatar.tsx';
import { connectWorkspace } from '../serialization/storage.ts';
import { useAiPresence } from '../editor/aiPresence.ts';
import { usePresence, type Peer } from '../editor/presence.ts';

/** Shown before "+N". */
const MAX_PEERS = 4;

function PeerAvatar({ peer }: { peer: Peer }) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = `${peer.name}${peer.role === 'viewer' ? ' (Viewing)' : ''}`;
  return (
    <span className="editor-avatar is-peer" role="img" aria-label={label} title={label} style={{ '--peer': peer.color } as CSSProperties}>
      {peer.image && !imageFailed ? <img src={peer.image} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : initials(peer.name)}
    </span>
  );
}

export function EditorPresence() {
  const account = useAccount(); const [name, setName] = useState(''); const [imageFailed, setImageFailed] = useState(false);
  const activity = useAiPresence(s => s.activity);
  const peers = usePresence(s => s.peers);
  const me = usePresence(s => s.me?.key);
  useEffect(() => { let disposed = false; void connectWorkspace().then(w => w.profile()).then(profile => { if (!disposed) setName(profile.name); }).catch(() => {}); return () => { disposed = true; }; }, []);
  useEffect(() => setImageFailed(false), [account?.image]);
  const user = name || account?.name || 'You';
  const label = user === 'You' ? 'You' : `${user} (You)`;
  // One avatar per person, however many tabs they have open (your other tabs are you).
  const people = [...new Map(Object.values(peers).filter(p => p.key !== me).map(p => [p.key, p])).values()];
  return <span className="editor-presence" aria-label="Active Participants">
    <span className="editor-avatar" role="img" aria-label={label} title={label}>
      {account?.image && !imageFailed ? <img src={account.image} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : user === 'You' ? <UserRound size={14} /> : initials(user, account?.email)}
    </span>
    {people.slice(0, MAX_PEERS).map(peer => <PeerAvatar key={peer.key} peer={peer} />)}
    {people.length > MAX_PEERS && <span className="editor-avatar editor-avatar-more" title={people.slice(MAX_PEERS).map(p => p.name).join(', ')}>+{people.length - MAX_PEERS}</span>}
    {activity.length > 0 && <span className="editor-avatar ai-avatar" role="img" aria-label="AI Is in This File" title="AI Is in This File">
      <Bot size={16} />
    </span>}
    {/* The favicon samples this animation; it is not part of the visible avatar. */}
    {activity.length > 0 && <span className="ai-favicon-spinner" aria-hidden="true"><Blocks size={32} duration={1300} /></span>}
  </span>;
}
