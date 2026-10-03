/** Shared facts for the public site. Keep claims here true to the product. */
export const SITE = {
  url: 'https://useplastic.app',
  name: 'Plastic',
  tagline: 'Indestructible Design',
  description:
    'Plastic is a visual design tool where HTML and CSS are the design. Draw, lay out and style real interfaces on a canvas, import Figma files, and work alongside your coding agents. Invite-only preview.',
  ogImage: 'https://useplastic.app/opengraph.png',
  signIn: '/?auth=sign-in',
} as const;

export const NAV = [
  { href: '/#features', label: 'Features' },
  { href: '/#agents', label: 'Agents' },
  { href: '/#how', label: 'How it works' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/download', label: 'Download' },
  { href: '/#faq', label: 'FAQ' },
] as const;

export interface Feature {
  icon: string;
  title: string;
  body: string;
}

/** The editor, honestly described (see README and the changelog). */
export const FEATURES: Feature[] = [
  {
    icon: 'lucide:code-xml',
    title: 'HTML and CSS are the file',
    body: 'Every frame is semantic HTML with a real stylesheet. No proprietary scene graph, no export step, nothing to translate later.',
  },
  {
    icon: 'lucide:layout-grid',
    title: 'Real layout: flex and grid',
    body: 'Wrap a selection in a stack and the direction and gap are inferred. Fit, Fixed, Fill and Relative sizing map straight to CSS.',
  },
  {
    icon: 'lucide:pen-tool',
    title: 'Pen tool and vector editing',
    body: 'Draw Bézier paths, drag anchors and handles, mirror or break them, and round any corner with a per-point radius.',
  },
  {
    icon: 'lucide:squares-unite',
    title: 'Shapes and path operations',
    body: 'Rectangles, ellipses, polygons and stars, plus Union, Subtract, Intersect, Exclude, Flatten and Outline stroke.',
  },
  {
    icon: 'lucide:blend',
    title: 'Gradients and fills',
    body: 'Linear and radial gradients with draggable stops, for boxes and vectors alike, written as plain CSS and SVG.',
  },
  {
    icon: 'lucide:magnet',
    title: 'Snapping, rulers and guides',
    body: 'Positions lock to edges, centers and points with live guide lines, and round to whole pixels when nothing is near.',
  },
  {
    icon: 'lucide:component',
    title: 'Components and variants',
    body: 'Build once, reuse everywhere. Instances stay in sync, and variants keep states and sizes in one place.',
  },
  {
    icon: 'lucide:monitor-smartphone',
    title: 'Responsive and interaction states',
    body: 'Edit breakpoints, hover, focus and active styles directly on the canvas, and preview them before they ship.',
  },
  {
    icon: 'lucide:palette',
    title: 'Design tokens and themes',
    body: 'Colors, type and spacing live as CSS custom properties in tokens.css, shared by every page in the file.',
  },
  {
    icon: 'lucide:braces',
    title: 'A live code panel',
    body: 'See the exact files being written, edit them with syntax highlighting, and watch the canvas update as you type.',
  },
  {
    icon: 'simple-icons:figma',
    title: 'Figma import',
    body: 'Drop in a .fig file. Pages, frames, auto layout, text, images, vectors and variables arrive as editable HTML and CSS.',
  },
  {
    icon: 'lucide:refresh-cw',
    title: 'Live sync and autosave',
    body: 'Saves happen as you work, edits from other tabs and tools merge in, and nothing waits on an export.',
  },
];

export const FAQ = [
  {
    q: 'What is Plastic?',
    a: 'Plastic is a visual design tool for real interfaces. Instead of drawing pictures of UI that someone rebuilds in code, you design directly in HTML and CSS on a canvas. What you save is the interface itself.',
  },
  {
    q: 'Why is Plastic invite-only?',
    a: 'We are growing carefully. Every invite is a real workspace with cloud storage, live sync and email, and we want each person to have a fast, reliable experience while we learn from early users. Join the waitlist and we will email you when your invite is ready.',
  },
  {
    q: 'How do invites work?',
    a: 'Join the waitlist with your email. We send invites in small waves, and telling us what you would like to make helps us prioritize. Your invite email contains a sign-up link; create your account with that same email address, or continue with Google using it.',
  },
  {
    q: 'Do I still need to hand designs off to engineers?',
    a: 'Far less. The design is already semantic HTML and CSS with tokens, so engineers and coding agents start from the real source instead of a screenshot. Frame links give them the exact frame with its full styling context.',
  },
  {
    q: 'Can I bring my Figma files?',
    a: 'Yes. In Figma choose File → Save local copy and drop the .fig file into Plastic. Pages, frames, auto layout, text, images, vectors and variables are converted into editable HTML and CSS.',
  },
  {
    q: 'Which AI agents work with Plastic?',
    a: 'Plastic exposes your designs and tokens over the Model Context Protocol (MCP), so Claude, Codex, Cursor, GitHub Copilot and other MCP-capable agents can read and edit them. Their changes appear live on the canvas, and you can see which layers an agent is reading or editing.',
  },
  {
    q: 'Do I own my files?',
    a: 'Yes. A Plastic file is a folder of plain files: one HTML file per page, tokens.css, styles.css and project.json. Open them in any editor, commit them to Git, or keep working on them with other tools.',
  },
  {
    q: 'Is there a desktop app?',
    a: 'A desktop app for macOS and Windows is on the way, built for local files and offline work. Plastic runs in your browser today; join the waitlist from the download page to hear when the desktop app is ready.',
  },
  {
    q: 'What does Plastic cost?',
    a: 'Pricing has not been announced yet, and the invite-only preview does not ask for payment details. Whatever comes next, your files remain plain HTML and CSS you can take anywhere.',
  },
] as const;
