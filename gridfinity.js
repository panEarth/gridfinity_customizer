// Gridfinity geometry built with manifold-3d.
// Dimensions follow the Gridfinity spec: 42 mm grid, 7 mm height units.

export const GRID = 42;        // grid pitch (mm)
export const HEIGHT_UNIT = 7;  // height unit (mm)
const CLEARANCE = 0.5;         // bin outer = 42*n - 0.5
const BIN_RADIUS = 3.75;       // bin outer corner radius
const PLATE_RADIUS = 4;        // baseplate cell corner radius
const BASE_H = 4.75;           // bin foot height
const PLATE_H = 4.65;          // baseplate profile height
const LIP_H = 4.4;             // stacking lip height above the 7u top
const HOLE_OFFSET = 13;        // magnet/screw hole offset from cell center
const EPS = 0.01;
const SEG = 48;

export const BIN_DEFAULTS = {
  gx: 2, gy: 1, gz: 3,
  lip: true, magnets: false, screws: false,
  wall: 1.2, floor: 1.0,
  divX: 0, divY: 0, divThick: 1.2,
  label: false, labelDepth: 12,
  scoop: 0,
};

export const PLATE_DEFAULTS = {
  gx: 3, gy: 3, style: "open", solidThickness: 2,
};

// Tracks every WASM object so it can be freed after each build.
function makeKit(wasm) {
  const { Manifold, CrossSection } = wasm;
  const pool = [];
  const k = o => (pool.push(o), o);

  // Rounded rectangle centered on the origin.
  const rrect = (w, d, r) => {
    r = Math.max(0, Math.min(r, w / 2 - EPS, d / 2 - EPS));
    const sq = k(CrossSection.square([w - 2 * r, d - 2 * r], true));
    return r > 0 ? k(sq.offset(r, "Round", 2, SEG)) : sq;
  };
  // Thin slab of a rounded rect at height z (used as a hull key frame).
  const slab = (w, d, r, z) => k(k(rrect(w, d, r).extrude(EPS)).translate([0, 0, z]));
  // Convex solid through a list of [inset, z] frames of a w×d box with corner radius r.
  const loft = (w, d, r, frames) =>
    k(Manifold.hull(frames.map(([inset, z]) => slab(w - 2 * inset, d - 2 * inset, r - inset, z))));
  const prism = (w, d, r, z0, z1) => k(k(rrect(w, d, r).extrude(z1 - z0)).translate([0, 0, z0]));
  const cyl = (h, rad, x, y, z) => k(k(Manifold.cylinder(h, rad, rad, SEG)).translate([x, y, z]));
  const box = (x0, y0, z0, x1, y1, z1) =>
    k(k(Manifold.cube([x1 - x0, y1 - y0, z1 - z0])).translate([x0, y0, z0]));
  const union = list => list.length === 1 ? list[0] : k(Manifold.union(list));
  const free = () => { for (const o of pool) { try { o.delete(); } catch (e) {} } pool.length = 0; };
  return { Manifold, k, rrect, slab, loft, prism, cyl, box, union, free };
}

const cellCenters = (gx, gy) => {
  const out = [];
  for (let i = 0; i < gx; i++)
    for (let j = 0; j < gy; j++)
      out.push([(i - (gx - 1) / 2) * GRID, (j - (gy - 1) / 2) * GRID]);
  return out;
};

const toMesh = m => {
  const mesh = m.getMesh();
  return {
    numProp: mesh.numProp,
    vertProperties: Float32Array.from(mesh.vertProperties),
    triVerts: Uint32Array.from(mesh.triVerts),
  };
};

export function buildBin(wasm, params) {
  const p = { ...BIN_DEFAULTS, ...params };
  const K = makeKit(wasm);
  try {
    const { k, loft, prism, cyl, box, union } = K;
    const W = GRID * p.gx - CLEARANCE, D = GRID * p.gy - CLEARANCE, R = BIN_RADIUS;
    const top = HEIGHT_UNIT * p.gz;               // top of the bin wall (7u)
    const T = p.lip ? top + LIP_H : top;           // absolute top
    const floorTop = BASE_H + p.floor;
    const t = p.wall;

    // Feet: 0.8 mm 45° chamfer, 1.8 mm vertical, 2.15 mm 45° chamfer.
    const footW = GRID - CLEARANCE;
    const feet = cellCenters(p.gx, p.gy).map(([x, y]) =>
      k(loft(footW, footW, R, [[2.95, 0], [2.15, 0.8], [2.15, 2.6], [0, BASE_H - EPS]]).translate([x, y, 0])));
    const body = prism(W, D, R, BASE_H - EPS, T);
    let solid = union([...feet, body]);

    // Interior cavity, with optional stacking-lip profile on top.
    const cuts = [];
    if (p.lip) {
      const ledge = 2.85;                              // lip inset at its lowest point
      const ledgeZ = T - 4.65;
      const z0 = Math.max(floorTop, ledgeZ - Math.max(0, ledge - t)); // 45° support under the ledge
      cuts.push(loft(W, D, R, [[0, T + 1], [0, T], [0.7, T - 0.7], [0.7, T - 2.5], [ledge, ledgeZ]]));
      if (ledge > t) cuts.push(loft(W, D, R, [[ledge, ledgeZ], [t, z0]]));
      if (z0 > floorTop) cuts.push(prism(W - 2 * t, D - 2 * t, R - t, floorTop, z0 + EPS));
    } else {
      cuts.push(prism(W - 2 * t, D - 2 * t, R - t, floorTop, T + 1));
    }
    solid = k(solid.subtract(union(cuts)));

    // Inner features stay below the lip so stacked bins still seat.
    const innerTop = p.lip ? top - 0.6 : T;
    const xi = W / 2 - t, yi = D / 2 - t;            // interior half-extents
    const adds = [];
    for (let i = 1; i <= p.divX; i++) {
      const x = -xi + (2 * xi) * i / (p.divX + 1);
      adds.push(box(x - p.divThick / 2, -yi - EPS, floorTop - EPS, x + p.divThick / 2, yi + EPS, innerTop));
    }
    for (let j = 1; j <= p.divY; j++) {
      const y = -yi + (2 * yi) * j / (p.divY + 1);
      adds.push(box(-xi - EPS, y - p.divThick / 2, floorTop - EPS, xi + EPS, y + p.divThick / 2, innerTop));
    }
    if (p.label) {
      // Label shelf along the back wall with a 45° support underneath.
      const ld = Math.min(p.labelDepth, 2 * yi - 2);
      const shelf = 1.2;
      const zTop = innerTop, zLow = Math.max(floorTop, zTop - shelf - ld);
      adds.push(k(K.Manifold.hull([
        box(-xi - EPS, yi - ld, zTop - shelf, xi + EPS, yi + EPS, zTop),
        box(-xi - EPS, yi - EPS, zLow, xi + EPS, yi + EPS, zLow + EPS),
      ])));
    }
    if (p.scoop > 0) {
      // Fillet between floor and front wall for scooping parts out.
      const r = Math.min(p.scoop, innerTop - floorTop - 1, yi);
      if (r > 0.5) {
        const block = box(-xi - EPS, -yi - EPS, floorTop - EPS, xi + EPS, -yi + r, floorTop + r);
        const round = k(k(k(K.Manifold.cylinder(2 * xi + 1, r, r, SEG * 2, true)).rotate([0, 90, 0]))
          .translate([0, -yi + r, floorTop + r]));
        adds.push(k(block.subtract(round)));
      }
    }
    if (adds.length) solid = k(solid.add(union(adds)));

    // Magnet (6.5 × 2.4 mm) and screw (3 × 6 mm) holes under each foot.
    const holes = [];
    for (const [cx, cy] of cellCenters(p.gx, p.gy))
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = cx + sx * HOLE_OFFSET, y = cy + sy * HOLE_OFFSET;
        if (p.magnets) holes.push(cyl(2.4 + EPS, 3.25, x, y, -EPS));
        if (p.screws) holes.push(cyl(Math.min(6, floorTop - 0.6) + EPS, 1.5, x, y, -EPS)); // never pierce the floor
      }
    if (holes.length) solid = k(solid.subtract(union(holes)));

    return { mesh: toMesh(solid), size: [W, D, T] };
  } finally {
    K.free();
  }
}

export function buildBaseplate(wasm, params) {
  const p = { ...PLATE_DEFAULTS, ...params };
  const K = makeKit(wasm);
  try {
    const { k, loft, prism, cyl, union } = K;
    const W = GRID * p.gx, D = GRID * p.gy, R = PLATE_RADIUS;
    const bottom = p.style === "magnet" ? 6.4 : p.style === "solid" ? p.solidThickness : 0;
    const T = bottom + PLATE_H;
    let solid = prism(W, D, R, 0, T);

    // Cell cutouts: 2.15 mm 45° chamfer, 1.8 mm vertical, 0.7 mm 45° chamfer.
    const cells = cellCenters(p.gx, p.gy).map(([x, y]) =>
      k(loft(GRID, GRID, R, [[0, T + 1], [0, T], [2.15, T - 2.15], [2.15, T - 3.95], [2.85, bottom], ...(bottom ? [] : [[2.85, -1]])])
        .translate([x, y, 0])));
    const cuts = [...cells];
    if (p.style === "magnet")
      for (const [cx, cy] of cellCenters(p.gx, p.gy))
        for (const sx of [-1, 1]) for (const sy of [-1, 1])
          cuts.push(cyl(2.4 + EPS, 3.25, cx + sx * HOLE_OFFSET, cy + sy * HOLE_OFFSET, bottom - 2.4));
    solid = k(solid.subtract(union(cuts)));
    return { mesh: toMesh(solid), size: [W, D, T] };
  } finally {
    K.free();
  }
}

// Binary STL from a manifold mesh.
export function meshToSTL(mesh) {
  const { numProp, vertProperties: v, triVerts: t } = mesh;
  const n = t.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < n; i++) {
    const a = t[3 * i] * numProp, b = t[3 * i + 1] * numProp, c = t[3 * i + 2] * numProp;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const val of [nx / l, ny / l, nz / l]) { dv.setFloat32(o, val, true); o += 4; }
    for (const idx of [a, b, c])
      for (let j = 0; j < 3; j++) { dv.setFloat32(o, v[idx + j], true); o += 4; }
    o += 2;
  }
  return buf;
}
