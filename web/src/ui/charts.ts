// Minimal canvas line charts for the P–V loop and piston displacement.

export interface Series {
  x: number[];
  y: number[];
  color: string;
  label: string;
  closed?: boolean;
}

export interface ChartOptions {
  xLabel: string;
  yLabel: string;
  xTicks?: number[];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= count + 0.5) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9 * span; v += step) out.push(+v.toPrecision(12));
  return out;
}

export class LineChart {
  private ctx: CanvasRenderingContext2D;
  private series: Series[] = [];
  private bounds = { x0: 0, x1: 1, y0: 0, y1: 1 };
  private marker: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: ChartOptions,
  ) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(series: Series[], bounds?: Partial<typeof this.bounds>): void {
    this.series = series;
    const xs = series.flatMap((s) => s.x);
    const ys = series.flatMap((s) => s.y);
    const pad = (a: number, b: number) => (b - a) * 0.06 || 1;
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    this.bounds = { x0, x1, y0: y0 - pad(y0, y1), y1: y1 + pad(y0, y1), ...bounds };
    this.draw();
  }

  /** Index into the series samples to mark; null for none. */
  setMarker(i: number | null): void {
    this.marker = i;
    this.draw();
  }

  draw(): void {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(canvas);
    const fg = css.getPropertyValue("--chart-fg").trim() || "#bbb";
    const grid = css.getPropertyValue("--chart-grid").trim() || "#444";
    const m = { l: 44, r: 10, t: 8, b: 30 };
    const pw = w - m.l - m.r;
    const ph = h - m.t - m.b;
    const { x0, x1, y0, y1 } = this.bounds;
    const X = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * pw;
    const Y = (y: number) => m.t + (1 - (y - y0) / (y1 - y0 || 1)) * ph;

    ctx.font = "11px system-ui, sans-serif";
    ctx.lineWidth = 1;
    ctx.strokeStyle = grid;
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of this.opts.xTicks ?? niceTicks(x0, x1)) {
      ctx.beginPath();
      ctx.moveTo(X(t), m.t);
      ctx.lineTo(X(t), m.t + ph);
      ctx.stroke();
      ctx.fillText(String(t), X(t), m.t + ph + 3);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of niceTicks(y0, y1)) {
      ctx.beginPath();
      ctx.moveTo(m.l, Y(t));
      ctx.lineTo(m.l + pw, Y(t));
      ctx.stroke();
      ctx.fillText(String(t), m.l - 4, Y(t));
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(this.opts.xLabel, m.l + pw / 2, h - 1);
    ctx.save();
    ctx.translate(10, m.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText(this.opts.yLabel, 0, 0);
    ctx.restore();

    ctx.lineWidth = 2;
    for (const s of this.series) {
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      s.x.forEach((x, i) => (i ? ctx.lineTo(X(x), Y(s.y[i])) : ctx.moveTo(X(x), Y(s.y[i]))));
      if (s.closed) ctx.closePath();
      ctx.stroke();
    }
    if (this.marker !== null) {
      for (const s of this.series) {
        const i = this.marker;
        if (i < 0 || i >= s.x.length) continue;
        ctx.fillStyle = s.color;
        ctx.strokeStyle = fg;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(X(s.x[i]), Y(s.y[i]), 4.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}
