// run with:  node --test test/markdown.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown as md } from "../js/markdown.js";

test("raw html is escaped, never rendered", () => {
    const out = md('<script>alert(1)</script> <img src=x onerror="alert(1)">');
    assert.ok(!out.includes("<script"));
    assert.ok(!out.includes("<img"));
    assert.ok(out.includes("&lt;script&gt;"));
});

test("javascript: and data: links lose their href", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "JaVaScRiPt:alert(1)", "vbscript:x"]) {
        const out = md(`[click](${bad})`);
        assert.ok(!/href=/i.test(out), bad);
        assert.ok(out.includes("click"));
    }
});

test("quotes can't break out of an href", () => {
    const out = md('[x](https://a.com/"onmouseover="alert(1))');
    assert.ok(!/href="[^"]*"[^>]*onmouseover/.test(out), out);
});

test("good links get rel + target, mailto stays plain", () => {
    assert.match(md("[a](https://example.com)"), /<a href="https:\/\/example.com" rel="noopener noreferrer" target="_blank">a<\/a>/);
    assert.match(md("[m](mailto:me@example.com)"), /<a href="mailto:me@example.com">m<\/a>/);
});

test("bare urls link without trailing punctuation or nesting", () => {
    const out = md("see https://example.com/page. nice");
    assert.match(out, /<a href="https:\/\/example.com\/page"[^>]*>https:\/\/example.com\/page<\/a>\. nice/);
    const labelled = md("[https://x.com](https://x.com)");
    assert.equal((labelled.match(/<a /g) || []).length, 1);
});

test("code blocks: escaped, language tag dropped, not wrapped in <p>", () => {
    const out = md("before\n\n```js\nconst a = '<b>';\n```\n\nafter");
    assert.ok(out.includes("<pre><code>const a = &#39;&lt;b&gt;&#39;;</code></pre>"), out);
    assert.ok(!out.includes("<p><pre>"));
    assert.ok(!out.includes(">js\n"));
});

test("formatting inside code is left alone", () => {
    assert.ok(md("`**not bold**`").includes("<code>**not bold**</code>"));
    assert.ok(md("```\n**x** [a](https://b.com)\n```").includes("**x** [a](https://b.com)"));
});

test("headings, lists, quotes, bold, italic", () => {
    assert.ok(md("# hi").includes("<h1>hi</h1>"));
    assert.ok(md("## hi").includes("<h2>hi</h2>"));
    assert.ok(md("- a\n- b").includes("<ul><li>a</li><li>b</li></ul>"));
    assert.ok(md("* a\n* b").includes("<ul><li>a</li><li>b</li></ul>"));
    assert.ok(md("1. a\n2. b").includes("<ol><li>a</li><li>b</li></ol>"));
    assert.ok(md("> quote").includes("<blockquote>quote</blockquote>"));
    assert.ok(md("**b** and *i*").includes("<strong>b</strong> and <em>i</em>"));
});

test("a heading followed directly by text keeps both", () => {
    const out = md("## title\nsome text");
    assert.ok(out.includes("<h2>title</h2>"));
    assert.ok(out.includes("<p>some text</p>"));
});

test("paragraphs and line breaks", () => {
    assert.equal(md("one\ntwo\n\nthree"), "<p>one<br>two</p><p>three</p>");
});

test("empty and whitespace input", () => {
    assert.equal(md(""), "");
    assert.equal(md(null), "");
    assert.equal(md("   \n\n  "), "");
});

test("control characters in the source can't forge placeholders", () => {
    const out = md("\u00010\u0001 hello");
    assert.ok(!out.includes("\u0001"));
});
