// The Guide: a step-by-step tour. Each page explains one part of the editor and points at its buttons on the
// screen (a ring around each, with an arrow from the card). It can only be closed from its last page.

import { clear, h } from "./dom";

type Content = Node | string;

export interface GuidePage {
  title: string;
  /** Paragraphs and blocks of the page. */
  body: Content[];
  /** data-guide names of the elements the page points at; missing or hidden ones are skipped. */
  targets?: string[];
}

/** A button or panel name in the text: same weight as the text around it, set apart by a light frame. */
export function ui(name: string): HTMLElement {
  return h("span", { class: "tour-ui" }, name);
}

export function key(name: string): HTMLElement {
  return h("kbd", { class: "tour-key" }, name);
}

/** A paragraph built from text and ui()/key() parts. */
export function p(...parts: Content[]): HTMLElement {
  return h("p", {}, ...parts);
}

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}) => {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
};

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const RING_PAD = 6;
const MARGIN = 16;

/** Visible rectangles of the page's targets (an element is skipped when hidden or not in the layout). */
function targetRects(names: string[]): Rect[] {
  const rects: Rect[] = [];
  for (const name of names) {
    for (const element of document.querySelectorAll<HTMLElement>(`[data-guide="${name}"]`)) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Clip to the viewport so rings around scrolling panels stay on screen.
      const rect = {
        left: Math.max(box.left - RING_PAD, 2),
        top: Math.max(box.top - RING_PAD, 2),
        right: Math.min(box.right + RING_PAD, window.innerWidth - 2),
        bottom: Math.min(box.bottom + RING_PAD, window.innerHeight - 2),
      };
      if (rect.right - rect.left > 4 && rect.bottom - rect.top > 4) rects.push(rect);
    }
  }
  return rects;
}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

const center = (rect: Rect): [number, number] => [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2];

/** Where the segment from the rectangle's centre towards (x, y) leaves the rectangle. */
function exitPoint(rect: Rect, x: number, y: number, gap = 0): [number, number] {
  const [cx, cy] = center(rect);
  const dx = x - cx;
  const dy = y - cy;
  const halfW = (rect.right - rect.left) / 2 + gap;
  const halfH = (rect.bottom - rect.top) / 2 + gap;
  const scale = Math.min(dx ? halfW / Math.abs(dx) : Infinity, dy ? halfH / Math.abs(dy) : Infinity);
  return Number.isFinite(scale) ? [cx + dx * scale, cy + dy * scale] : [cx, cy];
}

/**
 * Shows the guide over the editor. Left/right arrow keys and the buttons move between pages; Escape does not close it
 * (only the last page's button does).
 */
export function openGuide(pages: GuidePage[]): void {
  document.querySelector(".tour")?.remove();
  let index = 0;

  const shade = svg("svg", { class: "tour-shade", "aria-hidden": "true" });
  const card = h("div", { class: "tour-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "tour-title" });
  const root = h("div", { class: "tour" }, shade, card);

  const close = () => {
    window.removeEventListener("resize", layout);
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("focusin", onFocus);
    root.remove();
  };
  const go = (to: number) => {
    index = Math.max(0, Math.min(pages.length - 1, to));
    render();
  };
  const onKey = (event: KeyboardEvent) => {
    // Tab, Enter and Space work as usual on the card's own buttons.
    if (event.key === "Tab" || event.key === "Enter" || event.key === " ") return;
    if (event.key === "ArrowRight") go(index + 1);
    else if (event.key === "ArrowLeft") go(index - 1);
    // Every other key (Escape included) is kept from the editor behind the guide.
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Keeps keyboard focus inside the card.
  const onFocus = (event: FocusEvent) => {
    if (!card.contains(event.target as Node)) card.querySelector<HTMLElement>(".tour-nav.primary")?.focus();
  };

  const render = () => {
    const page = pages[index];
    const last = index === pages.length - 1;
    const back = h("button", { type: "button", class: "secondary tour-nav", disabled: index === 0, onclick: () => go(index - 1) }, "← Back");
    const next = last
      ? h("button", { type: "button", class: "primary tour-nav", onclick: close }, "Close the guide")
      : h("button", { type: "button", class: "primary tour-nav", onclick: () => go(index + 1) }, "Next →");
    const dots = h(
      "div",
      { class: "tour-dots", role: "tablist", "aria-label": "Pages" },
      ...pages.map((other, i) =>
        h("button", {
          type: "button",
          class: `tour-dot${i === index ? " active" : ""}`,
          title: other.title,
          "aria-label": `Page ${i + 1}: ${other.title}`,
          "aria-current": i === index ? "step" : undefined,
          onclick: () => go(i),
        })
      )
    );
    clear(
      card,
      h("div", { class: "tour-step" }, `${index + 1} / ${pages.length}`),
      h("h2", { id: "tour-title", class: "tour-title" }, page.title),
      h("div", { class: "tour-body" }, ...page.body),
      h("footer", { class: "tour-footer" }, back, dots, next)
    );
    card.scrollTop = 0;
    layout();
    next.focus();
  };

  /** Places the card away from the targets and draws the shade, rings and arrows. */
  function layout() {
    const page = pages[index];
    const rects = targetRects(page.targets ?? []);
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Card size first (it depends on the text), then the spot that hides the least of the targets.
    card.style.left = "0px";
    card.style.top = "0px";
    const cardW = card.offsetWidth;
    const cardH = card.offsetHeight;
    const spots: [number, number][] = [
      [(width - cardW) / 2, (height - cardH) / 2],
      [(width - cardW) / 2, height - cardH - MARGIN * 3],
      [(width - cardW) / 2, MARGIN * 4],
      [MARGIN * 4, (height - cardH) / 2],
      [width - cardW - MARGIN * 4, (height - cardH) / 2],
      [MARGIN * 4, height - cardH - MARGIN * 3],
      [width - cardW - MARGIN * 4, height - cardH - MARGIN * 3],
    ];
    let best = spots[0];
    let bestScore = Infinity;
    for (const [x, y] of spots) {
      const spot = { left: x - 24, top: y - 24, right: x + cardW + 24, bottom: y + cardH + 24 };
      // Covering a target is worst; after that, closer to the targets reads better (shorter arrows).
      const covered = rects.reduce((sum, rect) => sum + overlap(spot, rect), 0);
      const [sx, sy] = center(spot);
      const distance = rects.reduce((sum, rect) => sum + Math.hypot(sx - center(rect)[0], sy - center(rect)[1]), 0);
      const score = covered * 1000 + distance;
      if (score < bestScore - 1) {
        best = [x, y];
        bestScore = score;
      }
    }
    const left = Math.round(Math.max(MARGIN, Math.min(best[0], width - cardW - MARGIN)));
    const top = Math.round(Math.max(MARGIN, Math.min(best[1], height - cardH - MARGIN)));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    const cardRect = { left, top, right: left + cardW, bottom: top + cardH };

    // Shade with holes over the targets.
    shade.setAttribute("viewBox", `0 0 ${width} ${height}`);
    shade.setAttribute("width", String(width));
    shade.setAttribute("height", String(height));
    const defs = svg("defs");
    const mask = svg("mask", { id: "tour-mask" });
    mask.append(svg("rect", { x: 0, y: 0, width, height, fill: "white" }));
    for (const rect of rects) mask.append(svg("rect", { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, rx: 10, fill: "black" }));
    const marker = svg("marker", { id: "tour-arrow", viewBox: "0 0 10 10", refX: 7, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    marker.append(svg("path", { d: "M0,0 L10,5 L0,10 z", class: "tour-arrowhead" }));
    defs.append(mask, marker);
    const shapes: SVGElement[] = [svg("rect", { x: 0, y: 0, width, height, class: "tour-dim", mask: "url(#tour-mask)" })];
    for (const rect of rects) {
      shapes.push(svg("rect", { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, rx: 10, class: "tour-ring" }));
      // Arrow from the card's edge to the ring, bending a little so several arrows do not lie on top of each other.
      const [tx, ty] = center(rect);
      const [cx, cy] = center(cardRect);
      const [x1, y1] = exitPoint(cardRect, tx, ty, 6);
      const [x2, y2] = exitPoint(rect, cx, cy, 8);
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length < 24 || overlap(cardRect, rect) > 0) continue;
      const bend = Math.min(60, length * 0.18);
      const mx = (x1 + x2) / 2 - ((y2 - y1) / length) * bend;
      const my = (y1 + y2) / 2 + ((x2 - x1) / length) * bend;
      shapes.push(svg("path", { d: `M${x1},${y1} Q${mx},${my} ${x2},${y2}`, class: "tour-arrow", "marker-end": "url(#tour-arrow)" }));
    }
    shade.replaceChildren(defs, ...shapes);
  }

  // Clicks on the shade do nothing: the guide closes only from its last page.
  root.addEventListener("pointerdown", (event) => {
    if (!card.contains(event.target as Node)) event.preventDefault();
  });
  window.addEventListener("resize", layout);
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("focusin", onFocus);
  document.body.append(root);
  render();
}
