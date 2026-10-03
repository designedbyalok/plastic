/**
 * Release history, newest first. Written from the project's commit history; each entry is
 * what changed for people using Plastic.
 */
export interface Release {
  /** ISO date. */
  date: string;
  /** Stable anchor. */
  id: string;
  title: string;
  summary: string;
  tags: ('New' | 'Improved' | 'Fixed' | 'Performance' | 'Accounts')[];
  items: string[];
}

export const RELEASES: Release[] = [
  {
    date: '2026-10-03',
    id: 'invite-only-preview',
    title: 'Invite-only preview and a home on the web',
    summary: 'Plastic has a public site, a waitlist and invites, so new workspaces arrive in careful waves.',
    tags: ['New', 'Accounts'],
    items: [
      'A public site with this changelog and a download page for the upcoming desktop app.',
      'Join the waitlist from any page; invites arrive by email with a sign-up link.',
      'Accounts can be created only with an invited email address, whichever way you sign up.',
      'Continue with Google is available on the sign-in screen.',
    ],
  },
  {
    date: '2026-10-03',
    id: 'faster-and-leaner',
    title: 'A faster editor and leaner storage',
    summary: 'The editor loads less up front, and saving moves fewer bytes through fewer steps.',
    tags: ['Performance'],
    items: [
      'The editor’s code is split so Home, the editor, the code panel and the bundled Inter font each load only when needed.',
      'Interface libraries live in their own long-cached bundle, so updates download only what changed.',
      'Large files upload straight into storage with an integrity check computed in your browser.',
      'Superseded file versions are cleaned up automatically after a grace period.',
    ],
  },
  {
    date: '2026-10-03',
    id: 'emails-and-accounts',
    title: 'Emails that look like Plastic',
    summary: 'Account emails were designed in Plastic itself and adapt to light and dark mail clients.',
    tags: ['New', 'Accounts'],
    items: [
      'Email verification, welcome, sign-in notifications, password reset and magic-link sign-in.',
      'A password reset signs you out everywhere else, immediately.',
    ],
  },
  {
    date: '2026-10-03',
    id: 'thumbnails-and-previews',
    title: 'Thumbnails and link previews',
    summary: 'Your files look like your work, on the dashboard and wherever you share them.',
    tags: ['New'],
    items: [
      'Choose any frame as a file’s thumbnail; it refreshes when the design changes.',
      'Shared file and frame links show the thumbnail and file name in link previews.',
      'Only the preview image is public; editing always requires the owner’s account.',
    ],
  },
  {
    date: '2026-10-03',
    id: 'components-and-states',
    title: 'Components, variants, responsive and interaction states',
    summary: 'Build once and reuse it everywhere, then refine how it responds and behaves.',
    tags: ['New', 'Improved'],
    items: [
      'Reusable components with instances that stay in sync, and variants for states and sizes.',
      'Edit responsive breakpoints and hover, focus and active styles with a live canvas preview.',
      'Frame links hand an exact frame, with its full styling context, to engineers and agents.',
      'Rulers and guides, smarter text creation, native copy and paste, and layer dragging.',
      'Clearer Fit, Fixed, Fill and Relative sizing, and refined inspector controls.',
      'See which layers a connected AI agent is reading or editing.',
    ],
  },
  {
    date: '2026-10-03',
    id: 'fidelity-and-sync',
    title: 'CSS fidelity, safe rendering and automatic sync',
    summary: 'Imported and hand-written CSS keeps its cascade, and every change finds its way home.',
    tags: ['Improved', 'Fixed'],
    items: [
      'The original cascade, tokens, fonts and assets are preserved through editing.',
      'Artboards render in sandboxed frames, so design code can never run in the editor.',
      'Edits from another tab, device or tool merge automatically instead of overwriting each other.',
    ],
  },
  {
    date: '2026-10-02',
    id: 'snapping-radius-gradients',
    title: 'Snapping, per-point corner radius and gradients',
    summary: 'Precision tools for the details that make an interface feel finished.',
    tags: ['New'],
    items: [
      'Snap to edges, centers and points of other objects, with live guide lines, or to the pixel grid.',
      'Round individual corners of any path with a per-point radius.',
      'Linear and radial gradient editing with draggable stops for boxes and vectors.',
    ],
  },
  {
    date: '2026-10-02',
    id: 'vectors',
    title: 'Pen tool, shapes and path operations',
    summary: 'Vector work on the same canvas as your layout, saved as plain SVG.',
    tags: ['New'],
    items: [
      'A pen tool for Bézier paths, with anchor and handle editing and mirroring.',
      'Rectangle, ellipse, polygon and star tools with editable sides and ratios.',
      'Union, Subtract, Intersect, Exclude, Flatten and Outline stroke.',
      'Fill, stroke and shape settings in the inspector.',
    ],
  },
  {
    date: '2026-10-02',
    id: 'code-panel',
    title: 'An editable code panel',
    summary: 'The code view became an editor: change the source and the canvas follows.',
    tags: ['New'],
    items: [
      'Syntax highlighting, line numbers, search and undo for HTML, CSS and JSON.',
      'Edits apply to the design in real time; one-click formatting with Prettier.',
    ],
  },
  {
    date: '2026-10-02',
    id: 'home',
    title: 'A home for your files',
    summary: 'Files, folders, an archive and a profile, in light or dark.',
    tags: ['New'],
    items: [
      'Recents, Files with folders, and an Archive that keeps old work out of the way.',
      'A profile with your username and a year of activity.',
      'A light theme alongside the default dark one.',
    ],
  },
  {
    date: '2026-10-02',
    id: 'cloud',
    title: 'Plastic in the cloud, with live sync',
    summary: 'Your files follow you, and every open editor stays current.',
    tags: ['New'],
    items: [
      'Accounts, cloud file storage and images, served from Cloudflare’s network.',
      'Live sync between every tab and device that has a file open.',
      'Figma import works in the browser, with no upload of your .fig file.',
    ],
  },
  {
    date: '2026-10-02',
    id: 'foundations',
    title: 'The first canvas',
    summary: 'A visual editor whose source of truth is HTML and CSS.',
    tags: ['New'],
    items: [
      'Frames, semantic elements, flex stacks and a progressive inspector.',
      'Pages and design tokens shared across a file.',
      'Each artboard renders in its own frame, exactly as a browser would.',
      'Coding agents connect over MCP and edit designs live.',
    ],
  },
];
