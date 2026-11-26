/**
 * Text rendering for the text viewer, loaded on first use so image-only
 * sessions never pay for the highlighter or the Markdown parser.
 * Every HTML string returned here is safe to inject.
 */

/** Above this size highlighting costs more than it helps: shown as plain text. */
const HIGHLIGHT_LIMIT = 512 << 10;

const escape = (text: string) => text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Syntax-highlighted HTML for `text`, the language picked from the file extension. */
export async function highlight(text: string, extension: string): Promise<string> {
  if (text.length > HIGHLIGHT_LIMIT) return escape(text);
  const { default: hljs } = await import("highlight.js/lib/common");
  const language = hljs.getLanguage(extension) ? extension : null;
  // highlight.js escapes the source itself.
  return language ? hljs.highlight(text, { language }).value : escape(text);
}

let purifier: Promise<typeof import("dompurify").default> | null = null;

/** DOMPurify, configured once: images may only be inline data, never fetched from the network. */
function getPurifier() {
  purifier ??= import("dompurify").then(({ default: DOMPurify }) => {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "IMG" && !node.getAttribute("src")?.startsWith("data:")) node.removeAttribute("src");
    });
    return DOMPurify;
  });
  return purifier;
}

/** Markdown as sanitised HTML: scripts, handlers, styles and remote images are stripped. */
export async function renderMarkdown(text: string): Promise<string> {
  const [{ marked }, DOMPurify] = await Promise.all([import("marked"), getPurifier()]);
  const html = await marked.parse(text, { gfm: true });
  return DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "form", "iframe"], FORBID_ATTR: ["style"] });
}
