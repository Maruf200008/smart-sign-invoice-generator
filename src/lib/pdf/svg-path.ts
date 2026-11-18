import type { PathOp } from "@/lib/pdf/pdf-writer";

/**
 * SVG path data -> absolute PDF path operations (moveto, lineto, cubic curveto, closepath).
 * Supports the full path grammar: relative commands, H/V, S/T reflections, quadratics and elliptical arcs
 * (including compact flag syntax such as "a1 1 0 00 1 1").
 */
export function parseSvgPath(d: string): PathOp[] {
  const out: PathOp[] = [];
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastControlX = 0;
  let lastControlY = 0;
  let lastCommand = "";

  const isCommand = (token: string | undefined) => token !== undefined && /^[a-zA-Z]$/.test(token);
  const next = () => Number(tokens[index++]);
  // Arc flags may be written without separators ("01"), which the number regex reads as one token.
  const flag = () => {
    const token = tokens[index];
    if (token === undefined) return 0;
    if (token.length > 1 && /^[01]/.test(token)) {
      tokens[index] = token.slice(1);
      return Number(token[0]);
    }
    index += 1;
    return Number(token);
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++];
    } else if (!command) {
      break;
    }

    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;

    switch (command.toUpperCase()) {
      case "M": {
        x = ox + next();
        y = oy + next();
        startX = x;
        startY = y;
        out.push({ op: "M", x, y });
        // Extra coordinate pairs after a moveto are implicit linetos.
        command = relative ? "l" : "L";
        break;
      }
      case "L":
        x = ox + next();
        y = oy + next();
        out.push({ op: "L", x, y });
        break;
      case "H":
        x = ox + next();
        out.push({ op: "L", x, y });
        break;
      case "V":
        y = oy + next();
        out.push({ op: "L", x, y });
        break;
      case "C": {
        const x1 = ox + next();
        const y1 = oy + next();
        const x2 = ox + next();
        const y2 = oy + next();
        x = ox + next();
        y = oy + next();
        out.push({ op: "C", x1, y1, x2, y2, x, y });
        lastControlX = x2;
        lastControlY = y2;
        break;
      }
      case "S": {
        const reflect = /[CS]/i.test(lastCommand);
        const x1 = reflect ? 2 * x - lastControlX : x;
        const y1 = reflect ? 2 * y - lastControlY : y;
        const x2 = ox + next();
        const y2 = oy + next();
        x = ox + next();
        y = oy + next();
        out.push({ op: "C", x1, y1, x2, y2, x, y });
        lastControlX = x2;
        lastControlY = y2;
        break;
      }
      case "Q": {
        const qx = ox + next();
        const qy = oy + next();
        const endX = ox + next();
        const endY = oy + next();
        out.push(quadToCubic(x, y, qx, qy, endX, endY));
        x = endX;
        y = endY;
        lastControlX = qx;
        lastControlY = qy;
        break;
      }
      case "T": {
        const reflect = /[QT]/i.test(lastCommand);
        const qx = reflect ? 2 * x - lastControlX : x;
        const qy = reflect ? 2 * y - lastControlY : y;
        const endX = ox + next();
        const endY = oy + next();
        out.push(quadToCubic(x, y, qx, qy, endX, endY));
        x = endX;
        y = endY;
        lastControlX = qx;
        lastControlY = qy;
        break;
      }
      case "A": {
        const rx = next();
        const ry = next();
        const rotation = next();
        const largeArc = flag();
        const sweep = flag();
        const endX = ox + next();
        const endY = oy + next();
        out.push(...arcToCubics(x, y, rx, ry, rotation, largeArc, sweep, endX, endY));
        x = endX;
        y = endY;
        break;
      }
      case "Z":
        out.push({ op: "Z" });
        x = startX;
        y = startY;
        break;
      default:
        return out;
    }

    lastCommand = command;
    if (command.toUpperCase() === "Z" && !isCommand(tokens[index])) {
      // Numbers after Z are malformed; stop rather than loop.
      if (index < tokens.length) break;
    }
  }

  return out;
}

export function quadToCubic(x0: number, y0: number, qx: number, qy: number, x: number, y: number): PathOp {
  return {
    op: "C",
    x1: x0 + (2 / 3) * (qx - x0),
    y1: y0 + (2 / 3) * (qy - y0),
    x2: x + (2 / 3) * (qx - x),
    y2: y + (2 / 3) * (qy - y),
    x,
    y
  };
}

/** Endpoint-parameterised elliptical arc -> cubic Béziers (SVG 1.1 implementation notes, F.6.5). */
export function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angle: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number
): PathOp[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ op: "L", x: x2, y: y2 }];

  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  const vectorAngle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const length = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    const value = Math.acos(Math.min(1, Math.max(-1, dot / length)));
    return ux * vy - uy * vx < 0 ? -value : value;
  };

  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = vectorAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const kappa = (4 / 3) * Math.tan(step / 4);
  const point = (t: number) => {
    const px = rx * Math.cos(t);
    const py = ry * Math.sin(t);
    return { x: cos * px - sin * py + cx, y: sin * px + cos * py + cy };
  };
  const derivative = (t: number) => {
    const px = -rx * Math.sin(t);
    const py = ry * Math.cos(t);
    return { x: cos * px - sin * py, y: sin * px + cos * py };
  };

  const out: PathOp[] = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const t1 = theta1 + segment * step;
    const t2 = t1 + step;
    const p1 = point(t1);
    const p2 = point(t2);
    const d1 = derivative(t1);
    const d2 = derivative(t2);
    const end = segment === segments - 1 ? { x: x2, y: y2 } : p2;
    out.push({ op: "C", x1: p1.x + kappa * d1.x, y1: p1.y + kappa * d1.y, x2: p2.x - kappa * d2.x, y2: p2.y - kappa * d2.y, x: end.x, y: end.y });
  }
  return out;
}

/** Rounded rectangle with per-corner circular radii, clockwise from the top-left in a y-down space. */
export function roundedRectPath(x: number, y: number, width: number, height: number, radii: [number, number, number, number]): PathOp[] {
  let [tl, tr, br, bl] = radii.map((radius) => Math.max(0, radius)) as [number, number, number, number];
  // CSS rule: scale all radii down together until adjacent radii fit their side.
  const factor = Math.min(1, width / (tl + tr || Infinity), width / (bl + br || Infinity), height / (tl + bl || Infinity), height / (tr + br || Infinity));
  tl *= factor;
  tr *= factor;
  br *= factor;
  bl *= factor;

  const k = 0.5522847498;
  const path: PathOp[] = [{ op: "M", x: x + tl, y }];
  path.push({ op: "L", x: x + width - tr, y });
  if (tr) path.push({ op: "C", x1: x + width - tr + tr * k, y1: y, x2: x + width, y2: y + tr - tr * k, x: x + width, y: y + tr });
  path.push({ op: "L", x: x + width, y: y + height - br });
  if (br) path.push({ op: "C", x1: x + width, y1: y + height - br + br * k, x2: x + width - br + br * k, y2: y + height, x: x + width - br, y: y + height });
  path.push({ op: "L", x: x + bl, y: y + height });
  if (bl) path.push({ op: "C", x1: x + bl - bl * k, y1: y + height, x2: x, y2: y + height - bl + bl * k, x, y: y + height - bl });
  path.push({ op: "L", x, y: y + tl });
  if (tl) path.push({ op: "C", x1: x, y1: y + tl - tl * k, x2: x + tl - tl * k, y2: y, x: x + tl, y });
  path.push({ op: "Z" });
  return path;
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): PathOp[] {
  if (rx <= 0 || ry <= 0) return [];
  return [
    { op: "M", x: cx + rx, y: cy },
    ...arcToCubics(cx + rx, cy, rx, ry, 0, 0, 1, cx - rx, cy),
    ...arcToCubics(cx - rx, cy, rx, ry, 0, 0, 1, cx + rx, cy),
    { op: "Z" }
  ];
}

export function polyPath(points: string, close: boolean): PathOp[] {
  const values = (points.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const path: PathOp[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    path.push({ op: index === 0 ? "M" : "L", x: values[index], y: values[index + 1] });
  }
  if (close && path.length) path.push({ op: "Z" });
  return path;
}
