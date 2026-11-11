// Minimal 3MF writer: one mesh object, units in millimetres.
// A 3MF file is a ZIP package; this writes the ZIP by hand (deflate via
// CompressionStream when available, otherwise stored) so no library is needed.

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const xmlEscape = s => String(s).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
const num = v => { const r = Math.round(v * 1e4) / 1e4; return Object.is(r, -0) ? "0" : String(r); };

function modelXml(mesh, name) {
  const { numProp, vertProperties: v, triVerts: t } = mesh;
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>\n`,
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n`,
    ` <metadata name="Title">${xmlEscape(name)}</metadata>\n`,
    ` <metadata name="Application">Gridfinity Customizer</metadata>\n`,
    ` <resources>\n  <object id="1" type="model" name="${xmlEscape(name)}">\n   <mesh>\n    <vertices>\n`,
  ];
  for (let i = 0; i < v.length; i += numProp)
    parts.push(`<vertex x="${num(v[i])}" y="${num(v[i + 1])}" z="${num(v[i + 2])}"/>\n`);
  parts.push(`    </vertices>\n    <triangles>\n`);
  for (let i = 0; i < t.length; i += 3)
    parts.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>\n`);
  parts.push(`    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build>\n  <item objectid="1"/>\n </build>\n</model>\n`);
  return parts.join("");
}

// ---------- ZIP ----------
const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c >>> 0;
  }
  return tbl;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function zip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const raw = typeof data === "string" ? enc.encode(data) : data;
    const crc = crc32(raw);
    const deflated = await deflateRaw(raw);
    const method = deflated ? 8 : 0;
    const body = deflated || raw;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);          // version needed
    local.setUint16(6, 0x0800, true);      // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint16(10, 0, true);          // time
    local.setUint16(12, 0x21, true);       // date: 1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, body);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, method, true);
    cen.setUint16(12, 0, true);
    cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, body.length, true);
    cen.setUint32(24, raw.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: "model/3mf" });
}

export async function meshTo3MF(mesh, name = "Gridfinity") {
  return zip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: RELS },
    { name: "3D/3dmodel.model", data: modelXml(mesh, name) },
  ]);
}
