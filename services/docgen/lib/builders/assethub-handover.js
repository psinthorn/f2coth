// Builder: assethub_handover
// The AssetHub IT-asset handover deliverable (spec §9): title page, summary
// counts, network-equipment register, computer register, software appendix.
// Rendered from the HandoverData the assethub-api worker posts. Returns a
// docx `Document`; the shared kit supplies branding + the Thai-capable font.
const { Document, Paragraph, Table, TableRow, WidthType, PageBreak, ShadingType } = require("docx");
const k = require("../shared/docx-kit");

// A plain grid table with a bold header row. cols = array of {label, key, w}.
function grid(cols, rows) {
  const widths = cols.map((c) => c.w);
  const header = new TableRow({
    tableHeader: true,
    children: cols.map((c) =>
      k.cell([k.p(c.label, { run: { size: 16, bold: true, color: k.NAVY9 } })],
        { shading: { fill: k.LIGHT, type: ShadingType.CLEAR } })),
  });
  const body = rows.length
    ? rows.map((r) => new TableRow({
        children: cols.map((c) => k.cell([k.p(String(r[c.key] ?? ""), { run: k.small })])),
      }))
    : [new TableRow({ children: [k.cell([k.p("—", { run: k.small })], { columnSpan: cols.length })] })];
  return new Table({
    width: { size: k.CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [header, ...body],
  });
}

function build(data, opts = {}) {
  const watermark = !!opts.watermark;
  const d = data || {};
  const s = d.summary || {};
  const W = k.CONTENT_W;

  const summaryLines = [
    `Total assets / สินทรัพย์ทั้งหมด: ${s.total ?? 0}`,
    `Network equipment / อุปกรณ์เครือข่าย: ${s.network ?? 0}`,
    `Computers & devices / คอมพิวเตอร์และอุปกรณ์: ${s.computers ?? 0}`,
    `Domain / Workgroup / Standalone: ${s.domain ?? 0} / ${s.workgroup ?? 0} / ${s.standalone ?? 0}`,
  ];

  const networkTable = grid(
    [
      { label: "Type", key: "type", w: Math.round(W * 0.14) },
      { label: "Hostname", key: "hostname", w: Math.round(W * 0.24) },
      { label: "Brand", key: "brand", w: Math.round(W * 0.16) },
      { label: "Model", key: "model", w: Math.round(W * 0.18) },
      { label: "IP", key: "ip", w: Math.round(W * 0.14) },
      { label: "MAC", key: "mac", w: Math.round(W * 0.14) },
    ],
    d.network || [],
  );

  const computerTable = grid(
    [
      { label: "Hostname", key: "hostname", w: Math.round(W * 0.18) },
      { label: "Type", key: "type", w: Math.round(W * 0.1) },
      { label: "Model", key: "model", w: Math.round(W * 0.2) },
      { label: "Serial", key: "serial", w: Math.round(W * 0.16) },
      { label: "OS", key: "os", w: Math.round(W * 0.2) },
      { label: "Role", key: "network_role", w: Math.round(W * 0.16) },
    ],
    d.computers || [],
  );

  // Software appendix: flatten computers → one row per installed app.
  const swRows = [];
  for (const c of d.computers || []) {
    for (const sw of c.software || []) {
      swRows.push({ host: c.hostname, name: sw.name, version: sw.version, vendor: sw.vendor });
    }
  }
  const softwareTable = grid(
    [
      { label: "Device", key: "host", w: Math.round(W * 0.28) },
      { label: "Software", key: "name", w: Math.round(W * 0.34) },
      { label: "Version", key: "version", w: Math.round(W * 0.18) },
      { label: "Vendor", key: "vendor", w: Math.round(W * 0.2) },
    ],
    swRows,
  );

  const heading = (en, th) => new Paragraph({
    spacing: { before: 260, after: 120 },
    children: [k.runs(`${en}  /  ${th}`, { size: 22, bold: true, color: k.NAVY9 })],
  });

  return new Document({
    styles: k.documentStyles,
    numbering: k.numberingConfig([]),
    sections: [{
      properties: k.pageProps,
      headers: { default: k.makeHeader({ watermark }) },
      footers: { default: k.makeFooter() },
      children: [
        ...k.titleBlock({
          titleEn: "IT ASSET HANDOVER",
          titleTh: "รายงานส่งมอบสินทรัพย์ไอที",
          metaLine: `${d.customer_name || ""}${d.site_name ? " · " + d.site_name : ""}  ·  ${d.generated_at || ""}`,
        }),
        heading("Summary", "สรุป"),
        ...summaryLines.map((line) => new Paragraph({ spacing: { after: 60 }, children: [k.runs(line, { size: 20 })] })),

        heading("Network Equipment Register", "ทะเบียนอุปกรณ์เครือข่าย"),
        networkTable,

        heading("Computer Register", "ทะเบียนคอมพิวเตอร์"),
        computerTable,

        new Paragraph({ children: [new PageBreak()] }),
        heading("Software Appendix", "ภาคผนวกซอฟต์แวร์"),
        softwareTable,
      ],
    }],
  });
}

module.exports = { build };
