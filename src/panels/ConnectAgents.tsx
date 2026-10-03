/**
 * "Connect Your Agent": set up Plastic's MCP server in local coding agents so they can read and
 * write designs and tokens. One click where the agent offers a CLI or an install link; copyable
 * config for everything else.
 */
import { PanelSkeleton } from '../app/Skeleton.tsx';
import { Asterisk, Bot, Check, Code, Copy, Ellipsis, Loader, Minus, MousePointerClick, Plus, Rocket, SquareCode, SquareTerminal, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useEditor } from '../editor/store.ts';

interface Setup {
  command: string;
  args: string[];
  url: string;
  cli: Record<'claude' | 'codex', { available: boolean; connected: boolean }>;
}

type OneClick =
  | { kind: 'cli'; cli: 'claude' | 'codex'; text: string; label: string }
  | { kind: 'link'; text: string; label: string; href(setup: Setup): string };

interface ManualSection {
  title: string;
  steps: (string | { code: string })[];
}

interface Agent {
  id: string;
  name: string;
  icon: LucideIcon;
  oneClick?: OneClick;
  manual(setup: Setup): ManualSection[];
}

const SERVER = 'plastic';
const quote = (s: string) => (/^[\w./-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`);
const shell = (setup: Setup) => [setup.command, ...setup.args].map(quote).join(' ');
const mcpServersJson = (setup: Setup) => JSON.stringify({ mcpServers: { [SERVER]: { command: setup.command, args: setup.args } } }, null, 2);

const AGENTS: readonly Agent[] = [
  {
    id: 'claude',
    name: 'Claude',
    icon: Asterisk,
    oneClick: { kind: 'cli', cli: 'claude', text: 'Add Plastic to Claude Code', label: 'Add to Claude' },
    manual: (s) => [
      { title: 'Claude Code', steps: ['Run this in your terminal:', { code: `claude mcp add --scope user ${SERVER} -- ${shell(s)}` }, 'Then run /mcp in Claude Code to check that "plastic" is connected.'] },
      {
        title: 'Claude Desktop',
        steps: ['In Claude, open Settings → Developer → Edit Config.', 'Add Plastic to claude_desktop_config.json:', { code: mcpServersJson(s) }, 'Restart Claude.'],
      },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: SquareTerminal,
    oneClick: { kind: 'cli', cli: 'codex', text: 'Add Plastic to the Codex CLI and IDE extension', label: 'Add to Codex' },
    manual: (s) => [
      { title: 'Codex CLI', steps: ['Run this in your terminal:', { code: `codex mcp add ${SERVER} -- ${shell(s)}` }] },
      { title: 'Or Edit ~/.codex/config.toml', steps: [{ code: `[mcp_servers.${SERVER}]\ncommand = ${JSON.stringify(s.command)}\nargs = ${JSON.stringify(s.args)}` }] },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    icon: MousePointerClick,
    oneClick: {
      kind: 'link',
      text: 'Open Cursor and confirm the install',
      label: 'Add to Cursor',
      href: (s) => `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER}&config=${btoa(JSON.stringify({ command: s.command, args: s.args }))}`,
    },
    manual: (s) => [{ title: 'Edit ~/.cursor/mcp.json', steps: [{ code: mcpServersJson(s) }, 'Then enable "plastic" in Cursor Settings → MCP.'] }],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: Code,
    manual: (s) => [
      {
        title: 'Add to opencode.json',
        steps: [
          'In your project (or ~/.config/opencode/opencode.json):',
          { code: JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { [SERVER]: { type: 'local', command: [s.command, ...s.args], enabled: true } } }, null, 2) },
        ],
      },
    ],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    icon: Rocket,
    manual: (s) => [{ title: 'Add to mcp_config.json', steps: ['In the agent panel, open … → MCP Servers → Manage MCP Servers → View raw config.', { code: mcpServersJson(s) }] }],
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    icon: Bot,
    oneClick: { kind: 'link', text: 'Use Plastic in Copilot agent mode in VS Code', label: 'Add to VS Code', href: vscodeLink },
    manual: (s) => [{ title: 'Add to .vscode/mcp.json', steps: [{ code: vscodeJson(s) }, 'Then pick the tools in Copilot Chat → Agent mode → Tools.'] }],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    icon: SquareCode,
    oneClick: { kind: 'link', text: 'Open VS Code and confirm the install', label: 'Add to VS Code', href: vscodeLink },
    manual: (s) => [{ title: 'Add to .vscode/mcp.json (or Your User mcp.json)', steps: [{ code: vscodeJson(s) }] }],
  },
  {
    id: 'other',
    name: 'Other agents',
    icon: Ellipsis,
    manual: (s) => [
      { title: 'Local Command (stdio)', steps: ['Most agents accept a command to launch:', { code: shell(s) }, 'As JSON:', { code: mcpServersJson(s) }] },
      { title: 'HTTP (Streamable HTTP)', steps: ['While Plastic is running, agents that take a URL can use:', { code: s.url }] },
    ],
  },
];

function vscodeLink(s: Setup): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER, command: s.command, args: s.args }))}`;
}

function vscodeJson(s: Setup): string {
  return JSON.stringify({ servers: { [SERVER]: { type: 'stdio', command: s.command, args: s.args } } }, null, 2);
}

const PROMPTS = [
  'Create a sign-up page in Plastic with a real form and semantic HTML',
  'Add color and spacing tokens in Plastic and use them in my design',
  'Read my Plastic design and describe its layout and components',
];

export function ConnectAgents() {
  const [agentId, setAgentId] = useState('claude');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => useEditor.getState().setAgentsOpen(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/__plastic/agents');
      if (!response.ok) throw new Error(String(response.status));
      setSetup((await response.json()) as Setup);
    } catch {
      setError('Connecting agents needs the Plastic dev server. Start it with bun run dev.');
    }
  }, []);

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [load]);

  const agent = AGENTS.find((a) => a.id === agentId)!;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog agents-dialog" role="dialog" aria-modal="true" aria-labelledby="agents-title">
        <header className="dialog-header">
          <h2 id="agents-title">Connect Your Agent</h2>
        </header>
        <div className="agents-body">
          <nav className="agents-list" aria-label="Agents">
            {AGENTS.map((a) => (
              <button key={a.id} type="button" className={`agents-item${a.id === agentId ? ' is-active' : ''}`} aria-current={a.id === agentId} onClick={() => setAgentId(a.id)}>
                <a.icon size={17} strokeWidth={1.5} />
                {a.name}
              </button>
            ))}
          </nav>
          <div className="agents-steps">
            {error ? <p className="agents-error">{error}</p> : setup ? <AgentSteps key={agent.id} agent={agent} setup={setup} onRefresh={load} /> : <PanelSkeleton label="Loading Agent Setup" rows={2} />}
          </div>
        </div>
        <footer className="dialog-footer">
          <a className="dialog-link" href="https://github.com/designedbyalok/plastic/blob/main/docs/AGENTS.md" target="_blank" rel="noreferrer">
            Learn More
          </a>
          <button type="button" className="dialog-primary" onClick={close}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function AgentSteps({ agent, setup, onRefresh }: { agent: Agent; setup: Setup; onRefresh(): Promise<void> }) {
  const [manualOpen, setManualOpen] = useState(!agent.oneClick);
  const cli = agent.oneClick?.kind === 'cli' ? setup.cli[agent.oneClick.cli] : null;
  const connected = !!cli?.connected;
  return (
    <ol className="agents-steplist">
      <Step done title="Run Plastic">
        <p className="agents-note">Agents read and write the files in your workspace; this editor shows their changes live, and you can undo each one.</p>
      </Step>
      <Step done={connected} number={2} title={`Connect to ${agent.name}`}>
        {agent.oneClick && <OneClickBox oneClick={agent.oneClick} setup={setup} connected={connected} available={cli ? cli.available : true} onDone={onRefresh} />}
        <div className={`agents-manual${manualOpen ? ' is-open' : ''}`}>
          <button type="button" className="agents-manual-toggle" aria-expanded={manualOpen} onClick={() => setManualOpen(!manualOpen)}>
            {agent.oneClick ? 'Or, install manually' : 'Install manually'}
            {manualOpen ? <Minus size={15} strokeWidth={1.5} /> : <Plus size={15} strokeWidth={1.5} />}
          </button>
          {manualOpen &&
            agent.manual(setup).map((section) => (
              <div key={section.title} className="agents-manual-section">
                <h4>{section.title}</h4>
                {section.steps.map((step, i) => (typeof step === 'string' ? <p key={i}>{step}</p> : <CodeBlock key={i} code={step.code} />))}
              </div>
            ))}
        </div>
      </Step>
      <Step number={3} title="Run Your First Prompt">
        <p className="agents-note">Try one of these in {agent.id === 'other' ? 'your agent' : agent.name} to test the connection:</p>
        <div className="agents-prompts">
          {PROMPTS.map((p) => (
            <CopyChip key={p} text={p} />
          ))}
        </div>
      </Step>
    </ol>
  );
}

function Step({ done, number, title, children }: { done?: boolean; number?: number; title: string; children: ReactNode }) {
  return (
    <li className="agents-step">
      <span className={`agents-step-badge${done ? ' is-done' : ''}`} aria-hidden="true">
        {done ? <Check size={14} strokeWidth={2.5} /> : number}
      </span>
      <div className="agents-step-content">
        <h3>
          {title}
          {done && <span className="visually-hidden"> (done)</span>}
        </h3>
        {children}
      </div>
    </li>
  );
}

function OneClickBox({ oneClick, setup, connected, available, onDone }: { oneClick: OneClick; setup: Setup; connected: boolean; available: boolean; onDone(): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const install = async () => {
    if (oneClick.kind !== 'cli') return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/__plastic/agents/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: oneClick.cli }) });
      const result = (await response.json()) as { ok: boolean; output: string };
      setMessage(result.ok ? null : result.output || 'Install failed.');
      await onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="agents-oneclick">
      <div className="agents-oneclick-row">
        <span>{connected ? 'Plastic is connected.' : available ? oneClick.text : `The ${oneClick.kind === 'cli' ? oneClick.cli : ''} command isn't on your PATH. Install it, or set Plastic up manually below.`}</span>
        {oneClick.kind === 'cli' ? (
          <button type="button" className="agents-oneclick-button" disabled={busy || connected || !available} onClick={() => void install()}>
            {busy ? <Loader size={14} className="spin" /> : connected ? <Check size={14} strokeWidth={2} /> : null}
            {connected ? 'Connected' : oneClick.label}
          </button>
        ) : (
          <a className="agents-oneclick-button" href={oneClick.href(setup)}>
            {oneClick.label}
          </a>
        )}
      </div>
      {message && <pre className="agents-oneclick-error">{message}</pre>}
    </div>
  );
}

function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    () => {
      void navigator.clipboard?.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    },
  ];
}

function CodeBlock({ code }: { code: string }) {
  const [copied, copy] = useCopy(code);
  return (
    <div className="agents-code">
      <pre>{code}</pre>
      <button type="button" className="icon-button" aria-label="Copy" title={copied ? 'Copied' : 'Copy'} onClick={copy}>
        {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.5} />}
      </button>
    </div>
  );
}

function CopyChip({ text }: { text: string }) {
  const [copied, copy] = useCopy(text);
  return (
    <button type="button" className="agents-prompt" onClick={copy} title="Copy Prompt">
      {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.5} />}
      {text}
    </button>
  );
}
