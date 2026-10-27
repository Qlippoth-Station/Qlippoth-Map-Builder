import { ENTRY_ID, cellKey, inBounds, itemsOf, parseKey, type Brush, type Item, type LayerId } from "./document";
import type { Editor, SelectOp } from "./editor";
import { findItem, iconOrigin } from "./palette";

const BASE_CELL = 32;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
/** Up to this many visible cells are drawn one by one; beyond it (zoomed out on big maps) chunks are cached. */
const DIRECT_LIMIT = 6000;
const CHUNK = 16;
/** Pixels per cell in cached chunks. */
const CACHE_CELL = 8;

/** Canvas map view: rendering, camera (pan/zoom) and tool input. */
export class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private zoom = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dirty = true;
  private hover: [number, number] | null = null;
  private spaceHeld = false;
  /** Rendered chunks for zoomed-out drawing, keyed "cx,cy"; dropped when their cells or the layer view change. */
  private chunks = new Map<string, HTMLCanvasElement>();
  private chunkSignature = "";
  private chunkSource: Set<string> | null = null;

  private drag:
    | { kind: "pan"; startX: number; startY: number; originX: number; originY: number }
    | { kind: "paint"; last: [number, number]; brush: Brush | null }
    | { kind: "rect"; start: [number, number]; brush: Brush | null }
    | { kind: "select-rect"; start: [number, number]; op: SelectOp }
    | { kind: "select-cells"; last: [number, number]; op: SelectOp }
    | { kind: "move"; start: [number, number]; originX: number; originY: number }
    | null = null;

  /** Called when the hovered cell changes, for the status bar. */
  onHover: (cell: [number, number] | null) => void = () => {};

  constructor(private editor: Editor, host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "map-canvas";
    this.canvas.tabIndex = 0;
    host.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    new ResizeObserver(() => this.resize()).observe(host);
    this.bindInput();
    editor.subscribe((topics) => {
      if (topics.has("document") || topics.has("mode")) this.chunks.clear();
      if (topics.has("cells")) {
        for (const key of editor.takeChangedCells()) {
          const [x, y] = parseKey(key);
          this.chunks.delete(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`);
        }
      }
      this.invalidate();
    });

    const frame = () => {
      if (this.dirty) this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  invalidate(): void {
    this.dirty = true;
  }

  get cellSize(): number {
    return BASE_CELL * this.zoom;
  }

  /** Fits the whole map into the view. */
  fit(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    const doc = this.editor.doc;
    const zoom = Math.min((width - 48) / (doc.width * BASE_CELL), (height - 48) / (doc.height * BASE_CELL));
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.offsetX = (width - doc.width * this.cellSize) / 2;
    this.offsetY = (height - doc.height * this.cellSize) / 2;
    this.invalidate();
  }

  /** The map cell at the middle of the view (may lie outside the map). */
  centerCell(): [number, number] {
    const { width, height } = this.canvas.getBoundingClientRect();
    return this.screenToCell(width / 2, height / 2);
  }

  /** Centers the view on a cell (used by the warning list). */
  focus(x: number, y: number): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    const [sx, sy] = this.cellToScreen(x, y);
    this.offsetX += width / 2 - (sx + this.cellSize / 2);
    this.offsetY += height / 2 - (sy + this.cellSize / 2);
    this.hover = [x, y];
    this.invalidate();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    this.invalidate();
  }

  // Grid y grows upwards, screen y grows downwards.
  private cellToScreen(x: number, y: number): [number, number] {
    return [this.offsetX + x * this.cellSize, this.offsetY + (this.editor.doc.height - 1 - y) * this.cellSize];
  }

  private screenToCell(sx: number, sy: number): [number, number] {
    const x = Math.floor((sx - this.offsetX) / this.cellSize);
    const y = this.editor.doc.height - 1 - Math.floor((sy - this.offsetY) / this.cellSize);
    return [x, y];
  }

  // ---- Rendering -------------------------------------------------------------------------------

  private draw(): void {
    this.dirty = false;
    const { ctx, editor } = this;
    const doc = editor.doc;
    const ratio = window.devicePixelRatio || 1;
    const styles = getComputedStyle(document.documentElement);
    const color = (name: string) => styles.getPropertyValue(name).trim();

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const viewWidth = this.canvas.width / ratio;
    const viewHeight = this.canvas.height / ratio;
    ctx.fillStyle = color("--canvas-outside");
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    const cell = this.cellSize;
    const mapWidth = doc.width * cell;
    const mapHeight = doc.height * cell;
    ctx.fillStyle = color("--canvas-empty");
    ctx.fillRect(this.offsetX, this.offsetY, mapWidth, mapHeight);

    // Only the visible part of the map is drawn.
    const minX = Math.max(0, Math.floor(-this.offsetX / cell));
    const maxX = Math.min(doc.width - 1, Math.floor((viewWidth - this.offsetX) / cell));
    const maxY = Math.min(doc.height - 1, doc.height - 1 - Math.floor(-this.offsetY / cell));
    const minY = Math.max(0, doc.height - 1 - Math.floor((viewHeight - this.offsetY) / cell));

    if ((maxX - minX + 1) * (maxY - minY + 1) > DIRECT_LIMIT) {
      this.drawChunks(minX, maxX, minY, maxY);
    } else {
      for (const layer of editor.layers) {
        if (!editor.visible[layer]) continue;
        ctx.globalAlpha = this.layerAlpha(layer);
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const brush = editor.displayed(layer, x, y);
            if (brush) this.drawBrush(ctx, layer, brush, ...this.cellToScreen(x, y), cell);
          }
        }
      }
    }
    ctx.globalAlpha = 1;

    if (editor.showGrid && cell >= 8) {
      ctx.strokeStyle = color("--canvas-grid");
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = minX; x <= maxX + 1; x++) {
        const sx = Math.round(this.offsetX + x * cell) + 0.5;
        ctx.moveTo(sx, this.offsetY);
        ctx.lineTo(sx, this.offsetY + mapHeight);
      }
      for (let y = 0; y <= doc.height; y++) {
        const sy = Math.round(this.offsetY + y * cell) + 0.5;
        ctx.moveTo(this.offsetX, sy);
        ctx.lineTo(this.offsetX + mapWidth, sy);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = color("--canvas-border");
    ctx.lineWidth = 2;
    ctx.strokeRect(this.offsetX - 1, this.offsetY - 1, mapWidth + 2, mapHeight + 2);

    this.drawOverlay(color("--accent"));
  }

  private layerAlpha(layer: LayerId): number {
    return this.editor.dimInactive && layer !== this.editor.activeLayer ? 0.3 : 1;
  }

  /**
   * Zoomed out on a big map: each 16x16 chunk is rendered once at 8 px per cell and reused until its cells change.
   * Floating content is drawn on top every frame, since it moves.
   */
  private drawChunks(minX: number, maxX: number, minY: number, maxY: number): void {
    const { ctx, editor } = this;
    const signature = editor.layers.map((layer) => (editor.visible[layer] ? "1" : "0")).join("") + (editor.dimInactive ? editor.activeLayer : "");
    const source = editor.floating?.source ?? null;
    if (signature !== this.chunkSignature || source !== this.chunkSource) {
      this.chunks.clear();
      this.chunkSignature = signature;
      this.chunkSource = source;
    }
    const cell = this.cellSize;
    for (let cy = Math.floor(minY / CHUNK); cy <= Math.floor(maxY / CHUNK); cy++) {
      for (let cx = Math.floor(minX / CHUNK); cx <= Math.floor(maxX / CHUNK); cx++) {
        const key = `${cx},${cy}`;
        let canvas = this.chunks.get(key);
        if (!canvas) {
          canvas = this.renderChunk(cx, cy);
          this.chunks.set(key, canvas);
        }
        const [sx, sy] = this.cellToScreen(cx * CHUNK, cy * CHUNK + CHUNK - 1);
        ctx.drawImage(canvas, sx, sy, CHUNK * cell, CHUNK * cell);
      }
    }
    const floating = editor.floating;
    if (!floating) return;
    for (const [layer, cells] of floating.cells) {
      if (!editor.visible[layer]) continue;
      ctx.globalAlpha = this.layerAlpha(layer);
      for (const [key, brush] of cells) {
        const [rx, ry] = parseKey(key);
        const [x, y] = [floating.x + rx, floating.y + ry];
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        this.drawBrush(ctx, layer, brush, ...this.cellToScreen(x, y), cell);
      }
    }
  }

  private renderChunk(cx: number, cy: number): HTMLCanvasElement {
    const editor = this.editor;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = CHUNK * CACHE_CELL;
    const target = canvas.getContext("2d")!;
    target.imageSmoothingEnabled = false;
    for (const layer of editor.layers) {
      if (!editor.visible[layer]) continue;
      target.globalAlpha = this.layerAlpha(layer);
      for (let y = 0; y < CHUNK; y++) {
        for (let x = 0; x < CHUNK; x++) {
          const [gx, gy] = [cx * CHUNK + x, cy * CHUNK + y];
          if (!inBounds(editor.doc, gx, gy)) continue;
          const brush = editor.underFloating(layer, gx, gy);
          if (brush) this.drawBrush(target, layer, brush, x * CACHE_CELL, (CHUNK - 1 - y) * CACHE_CELL, CACHE_CELL);
        }
      }
    }
    return canvas;
  }

  /** Draws every item of a cell, bottom first. */
  private drawBrush(ctx: CanvasRenderingContext2D, layer: LayerId, brush: Brush, sx: number, sy: number, size: number): void {
    for (const item of itemsOf(brush)) this.drawItem(ctx, layer, item, sx, sy, size);
  }

  private drawItem(ctx: CanvasRenderingContext2D, layer: LayerId, brush: Item, sx: number, sy: number, size: number): void {
    const palette = this.editor.palette;
    const item = findItem(palette, layer, brush.id);

    if (item?.icon != null) {
      const [ax, ay] = iconOrigin(palette, item.icon);
      if (brush.rot) {
        // Game rotation is counter-clockwise with y up; on screen (y down) that is a negative canvas rotation.
        ctx.save();
        ctx.translate(sx + size / 2, sy + size / 2);
        ctx.rotate(-brush.rot);
        ctx.drawImage(palette.atlas, ax, ay, palette.iconSize, palette.iconSize, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        ctx.drawImage(palette.atlas, ax, ay, palette.iconSize, palette.iconSize, sx, sy, size, size);
      }
      return;
    }

    if (item?.glyph) {
      const inset = size * 0.12;
      ctx.fillStyle = item.color ?? "#888";
      ctx.globalAlpha *= 0.85;
      roundRect(ctx, sx + inset, sy + inset, size - inset * 2, size - inset * 2, size * 0.18);
      ctx.fill();
      ctx.globalAlpha /= 0.85;
      if (size < 10) return;
      ctx.fillStyle = "#fff";
      ctx.font = `600 ${Math.max(8, size * 0.45)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Entries show their place in the order when the order matters.
      const ordered = brush.id === ENTRY_ID && brush.order !== undefined && this.editor.doc.entry.mode !== "random";
      ctx.fillText(ordered ? `${item.glyph}${brush.order}` : item.glyph, sx + size / 2, sy + size / 2 + 1, size - 2);
      return;
    }

    if (item) {
      // Known entity without a sprite: neutral tile with its initial.
      const inset = size * 0.12;
      ctx.fillStyle = "rgba(140, 145, 160, 0.55)";
      roundRect(ctx, sx + inset, sy + inset, size - inset * 2, size - inset * 2, size * 0.18);
      ctx.fill();
      if (size < 10) return;
      ctx.fillStyle = "#fff";
      ctx.font = `600 ${Math.max(8, size * 0.4)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(item.name.charAt(0).toUpperCase(), sx + size / 2, sy + size / 2 + 1);
      return;
    }

    // Unknown id (palette changed since the file was made): hatched red cell.
    ctx.fillStyle = "rgba(220, 60, 60, 0.45)";
    ctx.fillRect(sx, sy, size, size);
    ctx.strokeStyle = "rgba(220, 60, 60, 0.9)";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + size, sy + size);
    ctx.moveTo(sx + size, sy);
    ctx.lineTo(sx, sy + size);
    ctx.stroke();
  }

  private drawOverlay(accent: string): void {
    const { ctx, editor } = this;
    const cell = this.cellSize;
    const danger = getComputedStyle(document.documentElement).getPropertyValue("--danger").trim() || "#e05555";

    if (editor.floating) {
      const { mask, x, y } = editor.floating;
      this.drawOutline(mask, x, y, accent, []);
    } else if (editor.selection) {
      this.drawOutline(editor.selection, 0, 0, accent, [5, 4]);
    }

    const drag = this.drag;
    if ((drag?.kind === "rect" || drag?.kind === "select-rect") && this.hover) {
      const [x0, y0] = drag.start;
      const [x1, y1] = this.hover;
      const [sx0, sy0] = this.cellToScreen(Math.min(x0, x1), Math.max(y0, y1));
      const w = (Math.abs(x1 - x0) + 1) * cell;
      const h = (Math.abs(y1 - y0) + 1) * cell;
      const color = drag.kind === "rect" && !drag.brush ? danger : accent;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(sx0, sy0, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (drag.kind === "select-rect") ctx.setLineDash([5, 4]);
      ctx.strokeRect(sx0 + 1, sy0 + 1, w - 2, h - 2);
      ctx.setLineDash([]);
      return;
    }

    if (this.hover && inBounds(editor.doc, ...this.hover) && drag?.kind !== "move") {
      const [sx, sy] = this.cellToScreen(...this.hover);
      const brush = editor.selectedBrush();
      if (brush && editor.action === "brush" && editor.editable(...this.hover)) {
        ctx.globalAlpha = 0.55;
        this.drawBrush(ctx, editor.activeLayer, brush, sx, sy, cell);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = editor.action === "erase" ? danger : accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, cell - 2, cell - 2);
    }
  }

  /** Outlines a set of cells (keys offset by dx, dy) along its outer edges. */
  private drawOutline(keys: Set<string>, dx: number, dy: number, color: string, dash: number[]): void {
    const { ctx } = this;
    const cell = this.cellSize;
    ctx.beginPath();
    for (const key of keys) {
      const [kx, ky] = parseKey(key);
      const [sx, sy] = this.cellToScreen(kx + dx, ky + dy);
      const [left, top, right, bottom] = [Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.round(sx + cell) + 0.5, Math.round(sy + cell) + 0.5];
      if (!keys.has(cellKey(kx, ky + 1))) (ctx.moveTo(left, top), ctx.lineTo(right, top));
      if (!keys.has(cellKey(kx, ky - 1))) (ctx.moveTo(left, bottom), ctx.lineTo(right, bottom));
      if (!keys.has(cellKey(kx - 1, ky))) (ctx.moveTo(left, top), ctx.lineTo(left, bottom));
      if (!keys.has(cellKey(kx + 1, ky))) (ctx.moveTo(right, top), ctx.lineTo(right, bottom));
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- Input -----------------------------------------------------------------------------------

  private bindInput(): void {
    const canvas = this.canvas;
    const local = (event: MouseEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    canvas.addEventListener("pointerdown", (event) => {
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
      const [sx, sy] = local(event);
      const cell = this.screenToCell(sx, sy);

      if (event.button === 1 || (event.button === 0 && this.spaceHeld)) {
        this.drag = { kind: "pan", startX: sx, startY: sy, originX: this.offsetX, originY: this.offsetY };
        canvas.classList.add("panning");
        return;
      }
      if (event.button === 2) {
        this.pick(...cell);
        return;
      }
      if (event.button !== 0) return;

      const editor = this.editor;
      if (editor.action === "select") {
        this.beginSelect(cell, event);
      } else {
        const layer = editor.activeLayer;
        const brush = editor.action === "erase" ? null : editor.selectedBrush();
        if (editor.action === "brush" && !brush) return;
        switch (editor.shape) {
          case "fill":
            editor.floodFill(layer, ...cell, brush);
            break;
          case "rect":
            this.drag = { kind: "rect", start: cell, brush };
            break;
          case "single":
            editor.beginStroke();
            editor.paint(layer, ...cell, brush);
            this.drag = { kind: "paint", last: cell, brush };
            break;
        }
      }
      this.invalidate();
    });

    canvas.addEventListener("pointermove", (event) => {
      const [sx, sy] = local(event);
      const cell = this.screenToCell(sx, sy);
      const drag = this.drag;

      if (drag?.kind === "pan") {
        this.offsetX = drag.originX + sx - drag.startX;
        this.offsetY = drag.originY + sy - drag.startY;
        this.invalidate();
      } else if (drag?.kind === "paint") {
        for (const [x, y] of line(drag.last, cell)) this.editor.paint(this.editor.activeLayer, x, y, drag.brush);
        drag.last = cell;
      } else if (drag?.kind === "select-cells") {
        this.editor.selectCells(line(drag.last, cell).map(([x, y]) => cellKey(x, y)), drag.op);
        drag.last = cell;
      } else if (drag?.kind === "move") {
        this.editor.moveFloating(drag.originX + cell[0] - drag.start[0], drag.originY + cell[1] - drag.start[1]);
      }
      this.updateCursor(cell);

      if (!this.hover || this.hover[0] !== cell[0] || this.hover[1] !== cell[1]) {
        this.hover = cell;
        this.onHover(inBounds(this.editor.doc, ...cell) ? cell : null);
        this.invalidate();
      }
    });

    const finish = () => {
      const drag = this.drag;
      this.drag = null;
      canvas.classList.remove("panning");
      if (drag?.kind === "paint") this.editor.endStroke();
      if (drag?.kind === "rect" && this.hover) this.editor.fillRect(this.editor.activeLayer, ...drag.start, ...this.hover, drag.brush);
      if (drag?.kind === "select-rect" && this.hover) this.editor.selectRect(...drag.start, ...this.hover, drag.op);
      this.invalidate();
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("pointerleave", () => {
      if (this.drag) return;
      this.hover = null;
      this.onHover(null);
      this.invalidate();
    });

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const [sx, sy] = local(event);
        const factor = Math.exp(-event.deltaY * 0.0015);
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
        // Keep the point under the cursor fixed while zooming.
        this.offsetX = sx - ((sx - this.offsetX) * zoom) / this.zoom;
        this.offsetY = sy - ((sy - this.offsetY) * zoom) / this.zoom;
        this.zoom = zoom;
        this.invalidate();
      },
      { passive: false }
    );

    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" && !isTyping(event)) {
        this.spaceHeld = true;
        canvas.classList.add("pan-ready");
        if (document.activeElement === canvas) event.preventDefault();
      }
    });
    window.addEventListener("keyup", (event) => {
      if (event.code === "Space") {
        this.spaceHeld = false;
        canvas.classList.remove("pan-ready");
      }
    });
  }

  /**
   * Select action. A plain press on the selection (or on floating content) starts moving it;
   * otherwise the shape decides what gets selected. Shift adds to the selection, Alt removes from it.
   */
  private beginSelect(cell: [number, number], event: PointerEvent): void {
    const editor = this.editor;
    const op: SelectOp = event.shiftKey ? "add" : event.altKey ? "subtract" : "replace";
    const onFloating = editor.floatingContains(...cell);
    const onSelection = !editor.floating && !!editor.selection?.has(cellKey(...cell));
    if (op === "replace" && (onFloating || onSelection) && editor.liftSelection()) {
      const { x, y } = editor.floating!;
      this.drag = { kind: "move", start: cell, originX: x, originY: y };
      return;
    }
    switch (editor.shape) {
      case "fill":
        editor.selectRegion(...cell, op);
        break;
      case "rect":
        editor.commitFloating();
        this.drag = { kind: "select-rect", start: cell, op };
        break;
      case "single":
        editor.selectCells([cellKey(...cell)], op);
        this.drag = { kind: "select-cells", last: cell, op: op === "replace" ? "add" : op };
        break;
    }
  }

  /** Move cursor over things that can be dragged with the select action. */
  private updateCursor(cell: [number, number]): void {
    const editor = this.editor;
    const movable =
      editor.action === "select" && (editor.floatingContains(...cell) || (!editor.floating && !!editor.selection?.has(cellKey(...cell))));
    this.canvas.classList.toggle("movable", movable || this.drag?.kind === "move");
  }

  /** Picks the topmost visible item under the cell and switches to its layer. */
  private pick(x: number, y: number): void {
    const editor = this.editor;
    if (!inBounds(editor.doc, x, y)) return;
    const order: LayerId[] = [editor.activeLayer, ...[...editor.layers].reverse().filter((layer) => layer !== editor.activeLayer)];
    editor.inspect(x, y);
    for (const layer of order) {
      const top = editor.visible[layer] ? itemsOf(editor.get(layer, x, y)).at(-1) : undefined;
      if (top) {
        editor.select(layer, top.id);
        return;
      }
    }
  }
}

export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
}

/** Cells on the line between two cells (Bresenham), excluding the start, so fast strokes leave no gaps. */
function line([x0, y0]: [number, number], [x1, y1]: [number, number]): [number, number][] {
  const cells: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let [x, y] = [x0, y0];
  while (x !== x1 || y !== y1) {
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
    cells.push([x, y]);
  }
  return cells;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
