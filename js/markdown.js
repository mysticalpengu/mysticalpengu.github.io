// markdown.js — a deliberately tiny markdown renderer.
//
// safety model: the input is HTML-escaped FIRST, so no raw HTML can ever
// reach the DOM. we then re-introduce a small whitelist of formatting on
// the escaped text. links are restricted to http(s) and mailto.

export function renderMarkdown(source) {
    if (!source) return "";

    let text = escapeHtml(source.trim());

    // fenced code blocks first — their content must not be further formatted
    const codeBlocks = [];
    text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
        const trimmed = code.replace(/^\n+|\n+$/g, "");
        codeBlocks.push(trimmed);
        return `\u0000CODE${codeBlocks.length - 1}\u0000`;
    });

    // headings (up to ###)
    text = text.replace(/^### (.*)$/gm, "<h3>$1</h3>");
    text = text.replace(/^## (.*)$/gm, "<h2>$1</h2>");
    text = text.replace(/^# (.*)$/gm, "<h1>$1</h1>");

    // blockquote lines
    text = text.replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>");

    // lists: consecutive - or * lines
    text = text.replace(/(?:^[-*] .*(?:\n|$))+/gm, (block) => {
        const items = block.trim().split("\n")
            .map((line) => `<li>${line.replace(/^[-*] /, "")}</li>`)
            .join("");
        return `<ul>${items}</ul>`;
    });

    // inline code
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

    // bold / italic
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // links: [label](url) — only http(s) and mailto survive
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, labelPart, url) => {
        if (!/^(https?:\/\/|mailto:)/i.test(url)) return labelPart;
        const external = url.toLowerCase().startsWith("http");
        const rel = external ? ' rel="noopener noreferrer" target="_blank"' : "";
        return `<a href="${url}"${rel}>${labelPart}</a>`;
    });

    // bare auto-links
    text = text.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, (match, pre, url) =>
        `${pre}<a href="${url}" rel="noopener noreferrer" target="_blank">${url}</a>`);

    // paragraphs: split on blank lines, join singles with <br>
    text = text
        .split(/\n{2,}/)
        .map((chunk) => {
            const t = chunk.trim();
            if (!t) return "";
            if (/^<(h\d|ul|blockquote|pre)/.test(t)) return t;
            return `<p>${t.replace(/\n/g, "<br>")}</p>`;
        })
        .join("");

    // restore code blocks
    text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, i) =>
        `<pre><code>${codeBlocks[Number(i)]}</code></pre>`);

    return text;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}
