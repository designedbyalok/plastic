import { useEffect, useState } from 'react';
import { Bot, UserRound } from 'lucide-react';
import { Blocks } from 'loading-dev';
import { useAccount } from '../auth/AuthGate.tsx';
import { initials } from '../home/Avatar.tsx';
import { connectWorkspace } from '../serialization/storage.ts';
import { useAiPresence } from '../editor/aiPresence.ts';

export function EditorPresence() {
  const account = useAccount(); const [name, setName] = useState(''); const [imageFailed, setImageFailed] = useState(false);
  const activity = useAiPresence(s => s.activity);
  useEffect(() => { let disposed = false; void connectWorkspace().then(w => w.profile()).then(profile => { if (!disposed) setName(profile.name); }).catch(() => {}); return () => { disposed = true; }; }, []);
  useEffect(() => setImageFailed(false), [account?.image]);
  const user = name || account?.name || 'You';
  const label = user === 'You' ? 'You' : `${user} (You)`;
  return <span className="editor-presence" aria-label="Active Participants">
    <span className="editor-avatar" role="img" aria-label={label} title={label}>
      {account?.image && !imageFailed ? <img src={account.image} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : user === 'You' ? <UserRound size={14} /> : initials(user, account?.email)}
    </span>
    {activity.length > 0 && <span className="editor-avatar ai-avatar" role="img" aria-label="AI Is in This File" title="AI Is in This File">
      <Bot size={16} />
    </span>}
    {/* The favicon samples this animation; it is not part of the visible avatar. */}
    {activity.length > 0 && <span className="ai-favicon-spinner" aria-hidden="true"><Blocks size={32} duration={1300} /></span>}
  </span>;
}
