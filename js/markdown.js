// markdown.js — a deliberately tiny markdown renderer.
//
// safety model: the input is HTML-escaped FIRST, so no raw HTML can ever reach
// the DOM. we then re-introduce a small whitelist of formatting on the escaped
// text. links are restricted to http(s) and mailto.
//
// supports: # ## ### headings · > quotes · - * lists · 1. lists · ``` code ```
//           `inline code` · **bold** · *italic* · [label](url) · bare urls

export function renderMarkdown(source) {
    if (!source) return "";

    const stashed = [];          // html we don't want later passes to touch
    const blockIdx = new Set();  // which stash entries are block-level (<pre>)
    const stash = (html, block = false) => {
        stashed.push(html);
        if (block) blockIdx.add(stashed.length - 1);
        return `\u0001${stashed.length - 1}\u0001`;
    };

    let text = escapeHtml(String(source).replace(/\u0000|\u0001/g, "").replace(/\r\n?/g, "\n").trim());

    // fenced code blocks first — their content must not be formatted further
    text = text.replace(/```[ \t]*[\w-]*[ \t]*\n([\s\S]*?)\n?```/g, (_, code) =>
        stash(`<pre><code>${code.replace(/^\n+|\n+$/g, "")}</code></pre>`, true));
    text = text.replace(/```([^`]+)```/g, (_, code) =>
        stash(`<pre><code>${code.trim()}</code></pre>`, true));

    const blocks = text.split(/\n{2,}/).map((chunk) => renderChunk(chunk, stash, blockIdx)).filter(Boolean);
    let html = blocks.join("");

    // put the stashed pieces back (stashed html can itself hold placeholders)
    for (let pass = 0; pass < 3 && /\u0001\d+\u0001/.test(html); pass++) {
        html = html.replace(/\u0001(\d+)\u0001/g, (_, i) => stashed[Number(i)] ?? "");
    }
    return html;
}

function renderChunk(chunk, stash, blockIdx) {
    const lines = chunk.split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (!line.trim()) { i++; continue; }

        // a lone placeholder for a code block
        const only = line.trim().match(/^\u0001(\d+)\u0001$/);
        if (only && blockIdx.has(Number(only[1]))) {
            out.push(line.trim());
            i++;
            continue;
        }

        const heading = line.match(/^(#{1,3}) +(.+)$/);
        if (heading) {
            const level = heading[1].length;
            out.push(`<h${level}>${inline(heading[2], stash)}</h${level}>`);
            i++;
            continue;
        }

        if (/^&gt; ?/.test(line)) {
            const quote = [];
            while (i < lines.length && /^&gt; ?/.test(lines[i])) {
                quote.push(inline(lines[i].replace(/^&gt; ?/, ""), stash));
                i++;
            }
            out.push(`<blockquote>${quote.join("<br>")}</blockquote>`);
            continue;
        }

        if (/^[-*] +/.test(line)) {
            const items = [];
            while (i < lines.length && /^[-*] +/.test(lines[i])) {
                items.push(`<li>${inline(lines[i].replace(/^[-*] +/, ""), stash)}</li>`);
                i++;
            }
            out.push(`<ul>${items.join("")}</ul>`);
            continue;
        }

        if (/^\d+[.)] +/.test(line)) {
            const items = [];
            while (i < lines.length && /^\d+[.)] +/.test(lines[i])) {
                items.push(`<li>${inline(lines[i].replace(/^\d+[.)] +/, ""), stash)}</li>`);
                i++;
            }
            out.push(`<ol>${items.join("")}</ol>`);
            continue;
        }

        // paragraph: keep going until the next block-looking line
        const para = [];
        while (
            i < lines.length && lines[i].trim() &&
            !/^(#{1,3} +|&gt; ?|[-*] +|\d+[.)] +)/.test(lines[i]) &&
            !/^\u0001\d+\u0001$/.test(lines[i].trim())
        ) {
            para.push(inline(lines[i], stash));
            i++;
        }
        if (para.length) out.push(`<p>${para.join("<br>")}</p>`);
    }

    return out.join("");
}

function inline(text, stash) {
    // inline code first, then stash it so bold/italic/links can't touch it
    text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${code}</code>`));

    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

    // [label](url) — only http(s) and mailto survive; anything else keeps just the label
    text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
        if (!/^(https?:\/\/|mailto:)/i.test(url)) return label;
        return stash(anchor(url, label));
    });

    // bare urls, without swallowing trailing punctuation
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<]+?)([.,;:!?)]*)(?=\s|$)/g, (match, pre, url, trail) =>
        `${pre}${stash(anchor(url, url))}${trail}`);

    return text;
}

function anchor(url, label) {
    const external = /^https?:/i.test(url);
    const attrs = external ? ' rel="noopener noreferrer" target="_blank"' : "";
    return `<a href="${url}"${attrs}>${label}</a>`;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}
