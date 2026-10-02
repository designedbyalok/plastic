# Connecting agents (MCP)

Plastic includes an [MCP](https://modelcontextprotocol.io) server so local coding agents —
Claude, Codex, Cursor, GitHub Copilot, VS Code, OpenCode, Antigravity and others — can read and
write designs and tokens.

Agents work on the same files the editor saves (`workspace/<file>/*.html`, `styles.css`,
`tokens.css`). Every tool call reads the project, applies Plastic's own document operations,
and writes the files back, so agent edits are exactly what the editor would produce. While the
editor is open it picks the change up immediately and shows it live, as one undoable step.
Reading is exact: tools return the saved HTML and CSS, which *is* the design.

## Connect

In the editor, deselect everything and press **Connect more agents** (inspector → MCP). The
dialog has one-click setup for Claude Code and Codex (through their own CLIs) and for Cursor
and VS Code / Copilot (through their install links), plus copy-paste config for every agent.

Manually, the server is a local command:

```bash
bun /path/to/plastic/server/mcp/stdio.ts
```

For example, with Claude Code:

```bash
claude mcp add --scope user plastic -- bun /path/to/plastic/server/mcp/stdio.ts
```

Use absolute paths; GUI apps often don't have `~/.bun/bin` on their `PATH`. Set
`PLASTIC_WORKSPACE` to point the server at another workspace folder.

While the dev server runs, agents that take a URL can use Streamable HTTP at
`http://localhost:5174/mcp`. It only accepts local requests (the `Host` and any browser
`Origin` must be localhost), which also blocks DNS-rebinding attacks from web pages.

## Tools

| Tool | What it does |
| --- | --- |
| `list_files` | Files in the workspace, with pages and token counts |
| `get_file` | Pages, artboards (id, name, position), classes and tokens of one file |
| `get_page` | A page as saved: an outline (tag.classes, `data-pl-id`, text), its HTML, artboard positions, `styles.css` and `tokens.css` |
| `get_node` | One element: tag, attributes, classes with their declarations, text, children, HTML |
| `get_frame` | Read a copied frame link: complete subtree HTML, ordered CSS, tokens, node metadata and asset paths |
| `create_file` | A new file (optionally with an empty artboard) |
| `add_frame` | An empty artboard on a page |
| `write_html` | Insert HTML into an element, or onto a page as artboards; class rules in `css` merge into `styles.css` |
| `set_page_html` | Replace a page's content |
| `update_styles` | Set or remove declarations on a class or on elements' own classes |
| `set_attributes` / `set_text` | Change attributes (and the tag) or text of an element |
| `move_node` / `delete_nodes` | Restructure |
| `create_page` / `rename_page` / `delete_page` | Pages (one HTML file each) |
| `get_tokens` / `set_tokens` / `rename_token` | Design tokens; renaming updates every `var()` |
| `import_figma` | Convert a local `.fig` file into a new Plastic file |

The server's instructions tell agents how Plastic files are organized: semantic HTML, one class
per element styled in `styles.css`, tokens as `var(--color-…)`, flex/grid inside artboards.

## Try

- "Create a sign-up page in Plastic with a real form and semantic HTML"
- "Add color and spacing tokens in Plastic and use them in my design"
- "Read my Plastic design and describe its layout and components"
