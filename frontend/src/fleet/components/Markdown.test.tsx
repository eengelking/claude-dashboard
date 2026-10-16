import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Markdown } from "./Markdown";

afterEach(cleanup);

const html = (src: string) => render(<Markdown source={src} />).container.innerHTML;
const dom = (src: string) => render(<Markdown source={src} />).container;

describe("Markdown", () => {
  it("renders headings", () => {
    const c = dom("# One\n\n## Two\n\n### Three");
    expect([...c.querySelectorAll("h1,h2,h3")].map((h) => [h.tagName, h.textContent])).toEqual([["H1", "One"], ["H2", "Two"], ["H3", "Three"]]);
  });

  it("renders unordered and ordered lists", () => {
    const c = dom("- a\n- b\n\n1. x\n2. y");
    expect([...c.querySelectorAll("ul > li")].map((l) => l.textContent)).toEqual(["a", "b"]);
    expect([...c.querySelectorAll("ol > li")].map((l) => l.textContent)).toEqual(["x", "y"]);
  });

  it("renders bold, italic and inline code", () => {
    const c = dom("a **bold** and *it* and _it2_ and `code` here");
    expect(c.querySelector("strong")!.textContent).toBe("bold");
    expect([...c.querySelectorAll("em")].map((e) => e.textContent)).toEqual(["it", "it2"]);
    expect(c.querySelector("code")!.textContent).toBe("code");
  });

  it("renders a fenced code block verbatim, markup inside left alone", () => {
    const c = dom("```ts\nconst a = **1**;\n  indented\n```");
    expect(c.querySelector("pre code")!.textContent).toBe("const a = **1**;\n  indented");
    expect(c.querySelector("strong")).toBeNull();
  });

  it("keeps a shorter fence inside a longer one as text (#274)", () => {
    const c = dom("````md\nbefore\n```ts\ncode\n```\nafter\n````\n\ntail");
    expect(c.querySelectorAll("pre")).toHaveLength(1);
    expect(c.querySelector("pre code")!.textContent).toBe("before\n```ts\ncode\n```\nafter");
    expect(c.querySelector("p")!.textContent).toBe("tail");
  });

  it("closes a fence on a longer fence, and not on a fence with an info string (#274)", () => {
    const c = dom("```\na\n```js\nb\n`````\n\ntail");
    expect(c.querySelector("pre code")!.textContent).toBe("a\n```js\nb");
    expect(c.querySelector("p")!.textContent).toBe("tail");
  });

  it("closes a fence the text never closes", () => {
    expect(dom("```\nunfinished").querySelector("pre code")!.textContent).toBe("unfinished");
  });

  it("renders block quotes", () => {
    const c = dom("> one\n> two\n\nafter");
    expect(c.querySelector("blockquote")!.textContent).toBe("one two");
    expect(c.querySelector("p")!.textContent).toBe("after");
  });

  it("links a URL with balanced parentheses in full (#274)", () => {
    const a = dom("see [wiki](https://en.wikipedia.org/wiki/A_(b)) now").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://en.wikipedia.org/wiki/A_(b)");
    expect(a.textContent).toBe("wiki");
  });

  it("does not take a closing parenthesis after the link into the URL (#274)", () => {
    const c = dom("(see [x](https://example.com/p)) end");
    expect(c.querySelector("a")!.getAttribute("href")).toBe("https://example.com/p");
    expect(c.textContent).toBe("(see x) end");
  });

  it("opens links in a new tab without opener or referrer", () => {
    const a = dom("see [the docs](https://example.com/x?a=1)").querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/x?a=1");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toBe("the docs");
  });

  it("does not make a link of javascript:, data: or other schemes", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "JaVaScRiPt:alert(1)"]) {
      const c = dom(`[click](${bad})`);
      expect(c.querySelector("a")).toBeNull();
      expect(c.textContent).toContain("click");
    }
  });

  it("shows raw HTML as text, never as elements", () => {
    const c = dom('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n**<b>x</b>**');
    expect(c.querySelector("script")).toBeNull();
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("b")).toBeNull();
    expect(c.textContent).toContain("<script>alert(1)</script>");
    expect(c.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("shows HTML inside code and link text as text too", () => {
    const c = dom("`<img onerror=x>` and [<i>t</i>](https://e.com)");
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("i")).toBeNull();
    expect(c.textContent).toContain("<img onerror=x>");
  });

  it("keeps plain text, empty input and odd markup from throwing", () => {
    expect(html("")).toBe("");
    expect(dom("just text").querySelector("p")!.textContent).toBe("just text");
    expect(() => dom("**unclosed *x `y [z](")).not.toThrow();
    expect(() => dom("#\n-\n1.\n>")).not.toThrow();
  });

  it("handles a large text", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `- item ${i} with **bold**`).join("\n");
    expect(dom(big).querySelectorAll("li")).toHaveLength(2000);
  });
});
