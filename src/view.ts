import { LAYERS, inBounds, type LayerId } from "./document";
import { primaryId, type Brush } from "./brush";
import type { Editor } from "./editor";
import { iconOrigin } from "./palette";

const BASE_CELL = 32;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

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

  private drag:
    | { kind: "pan"; startX: number; startY: number; originX: number; originY: number }
    | { kind: "paint"; last: [number, number]; brush: Brush | null }
    | { kind: "rect"; start: [number, number]; brush: Brush | null }
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
    editor.subscribe(() => this.invalidate());

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

    for (const layer of LAYERS) {
      if (!editor.visible[layer]) continue;
      ctx.globalAlpha = editor.dimInactive && layer !== editor.activeLayer ? 0.3 : 1;
      const cells = doc.layers[layer];
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const brush = cells.get(`${x},${y}`);
          if (brush) this.drawBrush(layer, brush, ...this.cellToScreen(x, y), cell);
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

  private drawBrush(layer: LayerId, brush: Brush, sx: number, sy: number, size: number): void {
    const { ctx } = this;
    const palette = this.editor.palette;
    const item = palette.byLayer[layer].get(primaryId(brush));

    if (item?.icon != null) {
      const [ax, ay] = iconOrigin(palette, item.icon);
      ctx.drawImage(palette.atlas, ax, ay, palette.iconSize, palette.iconSize, sx, sy, size, size);
      return;
    }

    if (item?.glyph) {
      const inset = size * 0.12;
      ctx.fillStyle = item.color ?? "#888";
      ctx.globalAlpha *= 0.85;
      roundRect(ctx, sx + inset, sy + inset, size - inset * 2, size - inset * 2, size * 0.18);
      ctx.fill();
      ctx.globalAlpha /= 0.85;
      ctx.fillStyle = "#fff";
      ctx.font = `600 ${Math.max(8, size * 0.45)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(item.glyph, sx + size / 2, sy + size / 2 + 1);
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

    if (this.drag?.kind === "rect" && this.hover) {
      const [x0, y0] = this.drag.start;
      const [x1, y1] = this.hover;
      const [sx0, sy0] = this.cellToScreen(Math.min(x0, x1), Math.max(y0, y1));
      const w = (Math.abs(x1 - x0) + 1) * cell;
      const h = (Math.abs(y1 - y0) + 1) * cell;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(sx0, sy0, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx0 + 1, sy0 + 1, w - 2, h - 2);
      return;
    }

    if (this.hover && inBounds(editor.doc, ...this.hover)) {
      const [sx, sy] = this.cellToScreen(...this.hover);
      const brush = editor.selectedBrush();
      if (brush && (editor.tool === "brush" || editor.tool === "rect" || editor.tool === "fill")) {
        ctx.globalAlpha = 0.55;
        this.drawBrush(editor.activeLayer, brush, sx, sy, cell);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = editor.tool === "erase" ? "#e05555" : accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, cell - 2, cell - 2);
    }
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
      const layer = editor.activeLayer;
      const brush = editor.tool === "erase" ? null : editor.selectedBrush();
      switch (editor.tool) {
        case "pick":
          this.pick(...cell);
          break;
        case "fill":
          if (brush) editor.floodFill(layer, ...cell, brush);
          break;
        case "rect":
          if (brush) this.drag = { kind: "rect", start: cell, brush };
          break;
        case "brush":
        case "erase":
          if (!brush && editor.tool === "brush") break;
          editor.beginStroke();
          editor.set(layer, ...cell, brush);
          this.drag = { kind: "paint", last: cell, brush };
          break;
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
        for (const [x, y] of line(drag.last, cell)) this.editor.set(this.editor.activeLayer, x, y, drag.brush);
        drag.last = cell;
      }

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

  /** Picks the topmost visible item under the cell and switches to its layer. */
  private pick(x: number, y: number): void {
    const editor = this.editor;
    if (!inBounds(editor.doc, x, y)) return;
    const order: LayerId[] = [editor.activeLayer, ...[...LAYERS].reverse().filter((layer) => layer !== editor.activeLayer)];
    for (const layer of order) {
      const brush = editor.visible[layer] ? editor.get(layer, x, y) : null;
      if (brush) {
        editor.select(layer, primaryId(brush));
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
