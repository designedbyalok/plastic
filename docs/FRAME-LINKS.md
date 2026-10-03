# Frame links and AI handoff

Select an artboard and use **Copy frame link** in the inspector. Links use stable node identity:

`/file/<project>?frame=<node-id>`

Nested frames support the same controls. **⌘L** copies the selected element/frame link;
with nothing selected it copies the file link. Typing controls and dialogs retain their
keyboard handling. The shortcut is listed in the editor's shortcut menu.

Opening the link selects the frame on its page and zooms to it, regardless of the saved viewport. Renaming does not change the link. Deleted frames produce a notice. Double-click the canvas title to edit the frame name; Enter or blur commits, Escape cancels. Name changes use ordinary undo and persistence.

## Reading with AI

A coding agent connected to Plastic's local MCP server can call `get_frame` with the copied URL. The tool resolves the file and frame locally; it never fetches an arbitrary supplied host. The result includes every descendant (including text nodes), semantic HTML, ordered CSS, tokens, SVG data, names, and the local assets directory. Global CSS, responsive/state rules and font faces are retained because dropping them can change the frame's rendering.

For nested targets, `contextHtml` includes the containing artboard, and `ancestors` identifies
the surrounding nodes. This retains inherited styles, ancestor selectors and parent layout.

The development server also provides a read-only, local-request endpoint at `/__plastic/frame/<project>/<frame>`. It returns the same source with the project's HTTP asset base. It does not publish a file publicly.

For an AI without access to the local workspace, use **Copy AI context** and paste the result into its conversation. This adds live element bounds, computed layout/typography/paint properties, and the artboard viewport size to the source. It retains asset references; private/local images and fonts may need to be supplied separately.

Frame navigation links work in the cloud editor under its existing account access. Public, anonymous cloud sharing and remote cloud MCP access are not implemented by this feature. A localhost URL cannot be fetched by a remote AI service.

## Fidelity

The source HTML and CSS provide a reproducible specification rather than a screenshot-based approximation. Reuse them and the original assets/fonts, then compare rendering at the same viewport. Browser engines, font availability, inaccessible assets and responsive/state selection can affect results; a universal 100% visual-match guarantee would be inaccurate.

## Validation

155 automated tests and the production build passed. MCP integration tests read a frame by URL through the actual stdio server. Browser checks in an isolated workspace covered deep-link selection/zoom, inline rename, cancellation, saved rename after reload, link copy and AI-context copy. The test capture included 216 nodes and 208 live element measurements. The local read endpoint returned the renamed frame and full source successfully.
