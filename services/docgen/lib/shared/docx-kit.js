// Shared docx primitives extracted from the production-proven
// make_agreement.js skeleton. Every builder (service-agreement, mutual-nda,
// future types) composes these so the F2 letterhead, footer, watermark,
// party panel, signature block and bilingual section table live ONCE.
const fs = require("fs");
const path = require("path");
const {
  Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, BorderStyle, WidthType, ShadingType, HeadingLevel,
  Header, Footer, ImageRun, PageNumber, TabStopType, TabStopPosition,
} = require("docx");
const F2 = require("../../config/f2");

const { NAVY, NAVY9, ACCENT, LIGHT, BRD, GREY } = F2.brand;
const F = F2.font;
const FONT = { ascii: F, hAnsi: F, cs: F, eastAsia: F };

const CONTENT_W = 9026; // A4 with 1" margins
const HALF = CONTENT_W / 2;

const ASSETS = path.join(__dirname, "..", "..", "assets");
const asset = (name) => fs.readFileSync(path.join(ASSETS, name));

const border = { style: BorderStyle.SINGLE, size: 1, color: BRD };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 100, bottom: 100, left: 140, right: 140 };
const small = { size: 19 };

function runs(text, opts = {}) {
  const o = { text, font: FONT, ...opts };
  o.sizeComplexScript = o.size || 20; // w:szCs — Thai text size
  if (o.bold) o.boldComplexScript = true; // w:bCs
  return new TextRun(o);
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [runs(text, opts.run || {})],
    ...opts.para,
  });
}

function bullet(text, ref) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 40 },
    children: [runs(text, { size: 19 })],
  });
}

function cell(children, opts = {}) {
  return new TableCell({
    borders,
    width: { size: HALF, type: WidthType.DXA },
    margins: cellMargins,
    ...opts,
    children,
  });
}

// Navy header row spanning the two bilingual columns of a section table.
function headerRow(en, th) {
  const mk = (t) =>
    cell(
      [new Paragraph({ spacing: { after: 0 }, children: [runs(t, { bold: true, size: 20, color: "FFFFFF" })] })],
      { shading: { fill: NAVY, type: ShadingType.CLEAR } }
    );
  return new TableRow({ children: [mk(en), mk(th)] });
}

function sectionRow(enChildren, thChildren) {
  return new TableRow({ children: [cell(enChildren), cell(thChildren)] });
}

// Numbering config for bullet lists. Pass the list of references a builder
// uses; each gets an independent bullet list so restarts don't interfere.
function numberingConfig(refs) {
  return {
    config: refs.map((ref) => ({
      reference: ref,
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 340, hanging: 200 } } },
      }],
    })),
  };
}

const pageProps = {
  page: {
    size: { width: 11906, height: 16838 }, // A4
    margin: { top: 1660, right: 1440, bottom: 1200, left: 1440 },
  },
};

// Letterhead. When `watermark` is true the F2 draft watermark image is placed
// behind every page; on the signing version it is omitted.
function makeHeader({ watermark }) {
  const children = [];
  if (watermark) {
    children.push(new Paragraph({
      spacing: { after: 0 },
      children: [
        new ImageRun({
          type: "png",
          data: asset("f2-watermark.png"),
          transformation: { width: 460, height: 460 },
          altText: { title: "Watermark", description: "F2 draft watermark", name: "f2wm" },
          floating: {
            behindDocument: true,
            zIndex: 0,
            horizontalPosition: { relative: "page", align: "center" },
            verticalPosition: { relative: "page", align: "center" },
          },
        }),
      ],
    }));
  }
  children.push(new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    spacing: { after: 40 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 4 } },
    children: [
      new ImageRun({
        type: "jpg",
        data: asset("f2-logo-color.jpeg"),
        transformation: { width: 40, height: 40 },
        altText: { title: "F2", description: "F2 Co., Ltd. logo", name: "f2logo" },
      }),
      runs(`\t${F2.provider.tagline}`, { size: 15, color: GREY }),
    ],
  }));
  return new Header({ children });
}

function makeFooter() {
  const line = `${F2.provider.legal_name.replace(/\s*\(.*\)$/, "")}  ·  ${F2.provider.website}  ·  ${F2.provider.notice_email}`;
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: BRD, space: 4 } },
        spacing: { after: 0 },
        children: [
          runs(line, { size: 15, color: GREY }),
          runs("\t", { size: 15 }),
          runs("Page ", { size: 15, color: GREY }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 15, color: GREY }),
          runs(" of ", { size: 15, color: GREY }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 15, color: GREY }),
        ],
      }),
    ],
  });
}

// Centred EN title + TH subtitle + a doc-no / version meta line.
function titleBlock({ titleEn, titleTh, metaLine }) {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 60 },
      children: [runs(titleEn, { size: 32, bold: true, color: NAVY9 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [runs(titleTh, { size: 22, bold: true, color: ACCENT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      children: [runs(metaLine, { size: 16, color: GREY })],
    }),
  ];
}

// Two-column Provider | Client legal-details panel. `client` is filled from
// the contract's party; `provider` defaults to F2.
function partyPanel(client) {
  const providerCell = new TableCell({
    borders: {
      top: border, bottom: border, right: border,
      left: { style: BorderStyle.SINGLE, size: 24, color: ACCENT },
    },
    width: { size: HALF, type: WidthType.DXA },
    shading: { fill: LIGHT, type: ShadingType.CLEAR },
    margins: { top: 140, bottom: 140, left: 200, right: 160 },
    children: [
      p("SERVICE PROVIDER / ผู้ให้บริการ", { run: { size: 17, bold: true, color: ACCENT } }),
      p(F2.provider.legal_name, { run: { size: 20, bold: true } }),
      p(`Tax ID / เลขประจำตัวผู้เสียภาษี: ${F2.provider.tax_id}`, { run: { size: 18 } }),
      p(F2.provider.address, { run: { size: 18, color: GREY } }),
      new Paragraph({ spacing: { after: 0 }, children: [runs(`${F2.provider.notice_email}  ·  ${F2.provider.website}`, { size: 18, color: GREY })] }),
    ],
  });

  const clientLines = [
    p("CLIENT / ผู้ว่าจ้าง", { run: { size: 17, bold: true, color: ACCENT } }),
    p(clientLegalLine(client), { run: { size: 20, bold: true } }),
  ];
  if (client.brand_name) clientLines.push(p(client.brand_name, { run: { size: 18 } }));
  if (client.tax_id) clientLines.push(p(`Tax ID / เลขประจำตัวผู้เสียภาษี: ${client.tax_id}`, { run: { size: 18 } }));
  if (client.address) clientLines.push(new Paragraph({ spacing: { after: 0 }, children: [runs(client.address, { size: 18, color: GREY })] }));

  const clientCell = new TableCell({
    borders: {
      top: border, bottom: border, right: border,
      left: { style: BorderStyle.SINGLE, size: 24, color: NAVY },
    },
    width: { size: HALF, type: WidthType.DXA },
    shading: { fill: LIGHT, type: ShadingType.CLEAR },
    margins: { top: 140, bottom: 140, left: 200, right: 160 },
    children: clientLines,
  });

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [HALF, HALF],
    rows: [new TableRow({ children: [providerCell, clientCell] })],
  });
}

// "Legal Name EN (Legal Name TH)" — TH omitted if identical/empty.
function clientLegalLine(client) {
  const en = client.legal_name_en || "";
  const th = client.legal_name_th || "";
  if (th && th !== en) return `${en} (${th})`;
  return en;
}

// Two-counterparts execution clause + Provider | Client signature table.
function signatureBlock({ PageBreak }, client) {
  const sigCell = (title, name) =>
    new TableCell({
      borders,
      width: { size: HALF, type: WidthType.DXA },
      margins: { top: 140, bottom: 140, left: 200, right: 200 },
      children: [
        p(title, { run: { size: 17, bold: true, color: ACCENT } }),
        p(name, { run: { size: 19, bold: true } }),
        new Paragraph({ spacing: { after: 0 }, children: [] }),
        new Paragraph({ spacing: { after: 0 }, children: [] }),
        new Paragraph({ spacing: { after: 0 }, children: [] }),
        new Paragraph({ spacing: { after: 60 }, children: [] }),
        p("_______________________________", { run: { size: 19 } }),
        p("Authorized Signature / ลายมือชื่อผู้มีอำนาจลงนาม", { run: { size: 16, color: GREY } }),
        p("Name / ชื่อ:  ________________________________", { run: { size: 18 } }),
        p("Position / ตำแหน่ง:  __________________________", { run: { size: 18 } }),
        p("Date / วันที่:  ________________________________", { run: { size: 18 } }),
        new Paragraph({ spacing: { after: 0 }, children: [runs("Company seal (if any) / ประทับตราบริษัท (ถ้ามี)", { size: 15, color: GREY })] }),
      ],
    });

  return [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ spacing: { before: 120, after: 40 }, children: [runs("This agreement is made in two (2) identical counterparts, with each party holding one counterpart of equal legal effect. IN WITNESS WHEREOF, the parties have read and understood the entire agreement and have executed it below.", { size: 19 })] }),
    new Paragraph({ spacing: { after: 120 }, children: [runs("สัญญานี้ทำขึ้นเป็นสองฉบับซึ่งมีข้อความถูกต้องตรงกัน โดยคู่สัญญาต่างยึดถือไว้ฝ่ายละหนึ่งฉบับและมีผลทางกฎหมายเท่าเทียมกัน คู่สัญญาได้อ่านและเข้าใจข้อความโดยตลอดแล้ว จึงลงลายมือชื่อไว้เป็นหลักฐาน", { size: 19 })] }),
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [HALF, HALF],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders, columnSpan: 2,
              width: { size: CONTENT_W, type: WidthType.DXA },
              shading: { fill: NAVY, type: ShadingType.CLEAR },
              margins: cellMargins,
              children: [new Paragraph({ spacing: { after: 0 }, children: [runs("Agreed and accepted by  |  ลงนามโดย", { bold: true, size: 20, color: "FFFFFF" })] })],
            }),
          ],
        }),
        new TableRow({
          children: [
            sigCell("SERVICE PROVIDER / ผู้ให้บริการ", F2.provider.legal_name),
            sigCell("CLIENT / ผู้ว่าจ้าง", clientLegalLine(client)),
          ],
        }),
      ],
    }),
  ];
}

// Default document styles shared by all builders.
const documentStyles = {
  default: { document: { run: { font: FONT, size: 20, sizeComplexScript: 20 } } },
  paragraphStyles: [
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal",
      run: { size: 28, bold: true, font: FONT, color: NAVY9, sizeComplexScript: 28, boldComplexScript: true },
      paragraph: { spacing: { before: 0, after: 120 }, outlineLevel: 0 } },
  ],
};

module.exports = {
  F2, FONT, NAVY, NAVY9, ACCENT, LIGHT, BRD, GREY,
  CONTENT_W, HALF, borders, border, cellMargins, small,
  runs, p, bullet, cell, headerRow, sectionRow,
  numberingConfig, pageProps, documentStyles,
  makeHeader, makeFooter, titleBlock, partyPanel, signatureBlock, clientLegalLine,
};
