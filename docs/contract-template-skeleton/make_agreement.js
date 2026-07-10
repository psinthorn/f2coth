const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, BorderStyle, WidthType, ShadingType, HeadingLevel,
  Header, Footer, ImageRun, PageNumber, TabStopType, TabStopPosition, PageBreak,
} = require("docx");

// F2 brand (from f2coth tailwind.config.ts)
const NAVY = "1E293B";      // navy-800 primary
const NAVY9 = "0F172A";     // navy-900
const ACCENT = "7C3AED";    // accent purple
const LIGHT = "F8FAFC";     // navy-50
const BRD = "E2E8F0";       // navy-200
const GREY = "64748B";      // navy-500

const F = "Noto Sans Thai"; // will be embedded in the docx so it renders everywhere
const FONT = { ascii: F, hAnsi: F, cs: F, eastAsia: F };
const CONTENT_W = 9026; // A4 with 1" margins
const HALF = CONTENT_W / 2;

const border = { style: BorderStyle.SINGLE, size: 1, color: BRD };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 100, bottom: 100, left: 140, right: 140 };

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

// Bullet numbering refs (unique per list so numbering restarts don't matter for bullets)
const numbering = {
  config: ["bEN2", "bTH2", "bEN3", "bTH3", "bEN4", "bTH4", "bEN5", "bTH5", "bEN6", "bTH6", "bEN7", "bTH7", "bEN8", "bTH8", "bEN9", "bTH9", "bEN10", "bTH10", "bEN11", "bTH11", "bEN12", "bTH12"].map((ref) => ({
    reference: ref,
    levels: [{
      level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 340, hanging: 200 } } },
    }],
  })),
};

const small = { size: 19 };

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 20, sizeComplexScript: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal",
        run: { size: 28, bold: true, font: FONT, color: "1F4E5F", sizeComplexScript: 28, boldComplexScript: true },
        paragraph: { spacing: { before: 0, after: 120 }, outlineLevel: 0 } },
    ],
  },
  numbering,
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1660, right: 1440, bottom: 1200, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [
          // Watermark: floating, behind text, repeats on every page via header
          new Paragraph({
            spacing: { after: 0 },
            children: [
              new ImageRun({
                type: "png",
                data: fs.readFileSync("f2-watermark.png"),
                transformation: { width: 460, height: 460 },
                altText: { title: "Watermark", description: "F2 SLA Draft watermark", name: "f2wm" },
                floating: {
                  behindDocument: true,
                  zIndex: 0,
                  horizontalPosition: { relative: "page", align: "center" },
                  verticalPosition: { relative: "page", align: "center" },
                },
              }),
            ],
          }),
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { after: 40 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 4 } },
            children: [
              new ImageRun({
                type: "jpg",
                data: fs.readFileSync("f2-logo-color.jpeg"),
                transformation: { width: 40, height: 40 },
                altText: { title: "F2", description: "F2 Co., Ltd. logo", name: "f2logo" },
              }),
              runs("\tThailand’s trusted IT partner for hospitality", { size: 15, color: GREY }),
            ],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: BRD, space: 4 } },
            spacing: { after: 0 },
            children: [
              runs("F2 Co., Ltd.  ·  f2.co.th  ·  f2coltd@gmail.com", { size: 15, color: GREY }),
              runs("\t", { size: 15 }),
              runs("Page ", { size: 15, color: GREY }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 15, color: GREY }),
              runs(" of ", { size: 15, color: GREY }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 15, color: GREY }),
            ],
          }),
        ],
      }),
    },
    children: [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 60 },
        children: [runs("IT SYSTEM AUDIT SERVICE AGREEMENT", { size: 32, bold: true, color: NAVY9 })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [runs("ข้อตกลงบริการตรวจสอบระบบไอที – ขอบเขตงาน", { size: 22, bold: true, color: ACCENT })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 220 },
        children: [runs("Scope of Work  ·  Doc No. F2-AGR-2026-MSK01  ·  Version 1.0", { size: 16, color: GREY })],
      }),

      // Parties panel — two columns with full legal details
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [HALF, HALF],
        rows: [new TableRow({
          children: [
            new TableCell({
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: BRD },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: BRD },
                right: { style: BorderStyle.SINGLE, size: 1, color: BRD },
                left: { style: BorderStyle.SINGLE, size: 24, color: ACCENT },
              },
              width: { size: HALF, type: WidthType.DXA },
              shading: { fill: LIGHT, type: ShadingType.CLEAR },
              margins: { top: 140, bottom: 140, left: 200, right: 160 },
              children: [
                p("SERVICE PROVIDER / ผู้ให้บริการ", { run: { size: 17, bold: true, color: ACCENT } }),
                p("F2 Co., Ltd. (บริษัท เอฟทู จำกัด)", { run: { size: 20, bold: true } }),
                p("Tax ID / เลขประจำตัวผู้เสียภาษี: 0845560003240", { run: { size: 18 } }),
                p("9/38 Moo 6, Bophut, Koh Samui, Surat Thani 84320", { run: { size: 18, color: GREY } }),
                new Paragraph({ spacing: { after: 0 }, children: [runs("f2coltd@gmail.com  ·  f2.co.th", { size: 18, color: GREY })] }),
              ],
            }),
            new TableCell({
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: BRD },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: BRD },
                right: { style: BorderStyle.SINGLE, size: 1, color: BRD },
                left: { style: BorderStyle.SINGLE, size: 24, color: NAVY },
              },
              width: { size: HALF, type: WidthType.DXA },
              shading: { fill: LIGHT, type: ShadingType.CLEAR },
              margins: { top: 140, bottom: 140, left: 200, right: 160 },
              children: [
                p("CLIENT / ผู้ว่าจ้าง", { run: { size: 17, bold: true, color: ACCENT } }),
                p("Miskawaan Company Limited (บริษัท มิสกวัน จำกัด)", { run: { size: 20, bold: true } }),
                p("Miskawaan Beachfront Villas (MHG Villas)", { run: { size: 18 } }),
                p("Tax ID / เลขประจำตัวผู้เสียภาษี: 0105549033541", { run: { size: 18 } }),
                new Paragraph({ spacing: { after: 0 }, children: [runs("67/28 Moo 1, Maenam, Koh Samui, Surat Thani 84330", { size: 18, color: GREY })] }),
              ],
            }),
          ],
        })],
      }),
      new Paragraph({ spacing: { before: 120, after: 200 }, children: [runs("Effective Date / วันที่เริ่มสัญญา:   ____________________", { size: 20, bold: true })] }),

      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [HALF, HALF],
        rows: [
          // 1. Purpose
          headerRow("1. Purpose", "1. วัตถุประสงค์"),
          sectionRow(
            [p("The Provider will perform an IT System Audit Service across the Client’s property: assess all IT systems against best-practice standards, identify risks, deliver a full audit report with an improvement roadmap to the management team, and track progress through weekly on-site visits over the contract term.", { run: small })],
            [p("ผู้ให้บริการจะดำเนินการตรวจสอบระบบไอที (IT System Audit) ทั่วทั้งสถานประกอบการของผู้ว่าจ้าง: ประเมินทุกระบบเทียบกับมาตรฐานแนวปฏิบัติที่ดี ระบุความเสี่ยง จัดทำรายงานผลการตรวจสอบฉบับสมบูรณ์พร้อมแผนปรับปรุงเสนอทีมผู้บริหาร และติดตามความคืบหน้าผ่านการเข้าปฏิบัติงานรายสัปดาห์ตลอดระยะเวลาสัญญา", { run: small })]
          ),

          // 2. Services included
          headerRow("2. Services Included", "2. บริการที่รวมในค่าบริการ"),
          sectionRow(
            [
              bullet("One (1) scheduled on-site audit visit per week, up to 3 hours per visit", "bEN2"),
              bullet("Full IT system audit per standard checklist: network, internet, Wi-Fi, CCTV, server/NAS, backup, computers, printers, email/Microsoft 365, security & accounts", "bEN2"),
              bullet("Complete hardware, software, and license inventory (asset register)", "bEN2"),
              bullet("Risk assessment with severity levels (High / Medium / Low)", "bEN2"),
              bullet("Weekly summary and monthly progress report", "bEN2"),
              bullet("Final audit report (EN/TH) with improvement roadmap and budget estimates, presented to the management team", "bEN2"),
              bullet("Advisory support and coordination with ISP/vendors during the audit", "bEN2"),
            ],
            [
              bullet("เข้าตรวจสอบที่สถานที่สัปดาห์ละ 1 ครั้ง ครั้งละไม่เกิน 3 ชั่วโมง", "bTH2"),
              bullet("ตรวจสอบระบบไอทีทั้งหมดตามรายการตรวจมาตรฐาน: เครือข่าย อินเทอร์เน็ต Wi-Fi กล้องวงจรปิด (CCTV) เซิร์ฟเวอร์/NAS ระบบสำรองข้อมูล คอมพิวเตอร์ เครื่องพิมพ์ อีเมล/Microsoft 365 และความปลอดภัย", "bTH2"),
              bullet("จัดทำทะเบียนทรัพย์สิน: ฮาร์ดแวร์ ซอฟต์แวร์ และไลเซนส์ทั้งหมด", "bTH2"),
              bullet("ประเมินความเสี่ยงพร้อมระดับความรุนแรง (สูง / กลาง / ต่ำ)", "bTH2"),
              bullet("สรุปประจำสัปดาห์และรายงานความคืบหน้าประจำเดือน", "bTH2"),
              bullet("รายงานผลการตรวจสอบฉบับสมบูรณ์ (อังกฤษ/ไทย) พร้อมแผนปรับปรุงและงบประมาณโดยประมาณ นำเสนอทีมผู้บริหาร", "bTH2"),
              bullet("ให้คำปรึกษาและประสานงานกับ ISP/ผู้ขายอุปกรณ์ระหว่างการตรวจสอบ", "bTH2"),
            ]
          ),

          // 3. Audit schedule
          headerRow("3. Audit Schedule (3 Months)", "3. แผนการตรวจสอบ (3 เดือน)"),
          sectionRow(
            [
              bullet("Month 1 — Kickoff (contacts, credentials, asset register) + Network & Internet + Wi-Fi audit", "bEN7"),
              bullet("Month 2 — Server/NAS & shared data + Backup & disaster recovery + Computers/printers + Email & Microsoft 365", "bEN7"),
              bullet("Month 3 — Security & user accounts + CCTV system audit (final phase) + final audit report compiled and presented to management", "bEN7"),
              bullet("Weekly summary every Friday; monthly progress report at each month end", "bEN7"),
            ],
            [
              bullet("เดือนที่ 1 — เริ่มโครงการ (ผู้ติดต่อ รหัสผ่าน ทะเบียนทรัพย์สิน) + ตรวจสอบเครือข่ายและอินเทอร์เน็ต + Wi-Fi", "bTH7"),
              bullet("เดือนที่ 2 — เซิร์ฟเวอร์/NAS และข้อมูลส่วนกลาง + ระบบสำรองข้อมูลและกู้คืน + คอมพิวเตอร์/เครื่องพิมพ์ + อีเมลและ Microsoft 365", "bTH7"),
              bullet("เดือนที่ 3 — ความปลอดภัยและบัญชีผู้ใช้ + ตรวจสอบระบบกล้องวงจรปิด (CCTV) เป็นลำดับสุดท้าย + จัดทำและนำเสนอรายงานผลการตรวจสอบฉบับสมบูรณ์ต่อผู้บริหาร", "bTH7"),
              bullet("สรุปประจำสัปดาห์ทุกวันศุกร์ และรายงานความคืบหน้าประจำเดือนทุกสิ้นเดือน", "bTH7"),
            ]
          ),

          // 4. Excluded
          headerRow("4. Services Not Included (charged separately)", "4. บริการที่ไม่รวม (คิดค่าใช้จ่ายเพิ่ม)"),
          sectionRow(
            [
              bullet("Hardware, spare parts, equipment, and software licenses", "bEN3"),
              bullet("New installations and project work (e.g. network cabling, additional access points, CCTV cameras, UPS, servers) – quoted separately for approval before starting", "bEN3"),
              bullet("Repair and implementation of improvements identified by the audit — quoted separately for approval", "bEN3"),
              bullet("Emergency on-site visits outside the scheduled visit day: 1,500 THB per call-out", "bEN3"),
              bullet("Any work outside the scope in Section 2", "bEN3"),
            ],
            [
              bullet("ฮาร์ดแวร์ อะไหล่ อุปกรณ์ และไลเซนส์ซอฟต์แวร์", "bTH3"),
              bullet("งานติดตั้งใหม่และงานโครงการ (เช่น เดินสายแลน เพิ่ม Access Point กล้อง CCTV UPS เซิร์ฟเวอร์) – เสนอราคาแยกต่างหากเพื่อขออนุมัติก่อนเริ่มงาน", "bTH3"),
              bullet("งานซ่อมแซมและดำเนินการปรับปรุงตามผลการตรวจสอบ — เสนอราคาแยกเพื่อขออนุมัติ", "bTH3"),
              bullet("เรียกเข้าปฏิบัติงานฉุกเฉินนอกวันนัดหมาย: ครั้งละ 1,500 บาท", "bTH3"),
              bullet("งานอื่นใดนอกเหนือขอบเขตในข้อ 2", "bTH3"),
            ]
          ),

          // 4. Fees
          headerRow("5. Fees & Payment", "5. ค่าบริการและการชำระเงิน"),
          sectionRow(
            [
              bullet("Total service fee: 45,000 THB (forty-five thousand baht) — special 3-month package price (15,000 THB × 3 months)", "bEN4"),
              bullet("Paid in advance in full upon signing; one invoice, due within 7 days of invoice date", "bEN4"),
              bullet("Service begins on the effective date after payment is received", "bEN4"),
              bullet("Fee excludes hardware, parts, licenses, and project work (Section 4)", "bEN4"),
            ],
            [
              bullet("ค่าบริการรวมทั้งสิ้น: 45,000 บาท (สี่หมื่นห้าพันบาทถ้วน) — ราคาพิเศษแบบแพ็กเกจ 3 เดือน (15,000 บาท × 3 เดือน)", "bTH4"),
              bullet("ชำระล่วงหน้าเต็มจำนวนเมื่อลงนามสัญญา ออกใบแจ้งหนี้ครั้งเดียว ชำระภายใน 7 วันนับจากวันที่ใบแจ้งหนี้", "bTH4"),
              bullet("เริ่มให้บริการตามวันที่เริ่มสัญญาหลังจากได้รับชำระเงินแล้ว", "bTH4"),
              bullet("ค่าบริการไม่รวมฮาร์ดแวร์ อะไหล่ ไลเซนส์ และงานโครงการ (ข้อ 4)", "bTH4"),
            ]
          ),

          // 5. Term
          headerRow("6. Term & Termination", "6. ระยะเวลาและการยกเลิก"),
          sectionRow(
            [
              bullet("Initial term: three (3) months from the effective date above", "bEN5"),
              bullet("After the initial term, the agreement renews automatically month-to-month", "bEN5"),
              bullet("After the initial term, either party may terminate with thirty (30) days’ written notice", "bEN5"),
              bullet("As this is a special 3-month package price paid in advance, the fee is non-refundable in all cases", "bEN5"),
              bullet("Renewal months are invoiced monthly at 15,000 THB/month", "bEN5"),
            ],
            [
              bullet("ระยะเวลาเริ่มต้น: 3 เดือน นับจากวันที่เริ่มสัญญาข้างต้น", "bTH5"),
              bullet("เมื่อครบกำหนด สัญญาต่ออายุอัตโนมัติแบบรายเดือน", "bTH5"),
              bullet("หลังครบระยะเวลาเริ่มต้น ฝ่ายใดฝ่ายหนึ่งยกเลิกได้โดยแจ้งเป็นลายลักษณ์อักษรล่วงหน้า 30 วัน", "bTH5"),
              bullet("เนื่องจากเป็นราคาพิเศษแบบแพ็กเกจ 3 เดือนชำระล่วงหน้า ค่าบริการไม่สามารถขอคืนได้ในทุกกรณี", "bTH5"),
              bullet("เดือนต่ออายุออกใบแจ้งหนี้รายเดือน เดือนละ 15,000 บาท", "bTH5"),
            ]
          ),

          // 6. SLA
          headerRow("7. Service Levels (SLA)", "7. ระดับการให้บริการ (SLA)"),
          sectionRow(
            [
              bullet("Service hours: Monday–Saturday, 09:00–18:00 (business hours)", "bEN6"),
              bullet("Critical (whole property affected, e.g. internet/server/CCTV recording down): remote response within 2 business hours; on-site same or next business day", "bEN6"),
              bullet("High (one area or several users affected): remote response within 4 business hours", "bEN6"),
              bullet("Medium / Low (single user, requests): handled at the next weekly visit", "bEN6"),
              bullet("Issues must be reported via the agreed contact channel; response time counts from the time of report", "bEN6"),
              bullet("Excluded from SLA: ISP outages, power failures, hardware delivery lead times, and third-party vendor delays", "bEN6"),
              bullet("SLA performance is reported in the monthly summary", "bEN6"),
            ],
            [
              bullet("เวลาให้บริการ: วันจันทร์–เสาร์ เวลา 09:00–18:00 น. (เวลาทำการ)", "bTH6"),
              bullet("วิกฤต (กระทบทั้งสถานประกอบการ เช่น อินเทอร์เน็ต/เซิร์ฟเวอร์/การบันทึก CCTV ล่ม): ตอบสนองทางไกลภายใน 2 ชั่วโมงทำการ เข้าหน้างานภายในวันเดียวกันหรือวันทำการถัดไป", "bTH6"),
              bullet("สูง (กระทบหนึ่งพื้นที่หรือผู้ใช้หลายคน): ตอบสนองทางไกลภายใน 4 ชั่วโมงทำการ", "bTH6"),
              bullet("กลาง / ต่ำ (ผู้ใช้รายเดียว หรืองานร้องขอทั่วไป): ดำเนินการในการเข้าปฏิบัติงานรายสัปดาห์ครั้งถัดไป", "bTH6"),
              bullet("ต้องแจ้งปัญหาผ่านช่องทางติดต่อที่ตกลงกัน โดยนับเวลาตอบสนองจากเวลาที่แจ้ง", "bTH6"),
              bullet("ไม่นับรวมใน SLA: เหตุขัดข้องจาก ISP ไฟฟ้าดับ ระยะเวลารออะไหล่/อุปกรณ์ และความล่าช้าจากผู้ให้บริการภายนอก", "bTH6"),
              bullet("รายงานผล SLA ในสรุปประจำเดือน", "bTH6"),
            ]
          ),

          // 8. Client obligations
          headerRow("8. Client Obligations", "8. หน้าที่ของผู้ว่าจ้าง"),
          sectionRow(
            [
              bullet("Provide access to premises, systems, and equipment during scheduled visits", "bEN9"),
              bullet("Provide accurate information, credentials, and documentation required for the audit", "bEN9"),
              bullet("Appoint one contact person authorised to coordinate work and receive reports", "bEN9"),
              bullet("Ensure relevant staff are available when needed and provide safe working conditions", "bEN9"),
              bullet("SLA and schedule timelines are paused for delays caused by the Client or the Client’s third parties", "bEN9"),
            ],
            [
              bullet("จัดให้เข้าถึงสถานที่ ระบบ และอุปกรณ์ในวันเข้าปฏิบัติงานตามนัดหมาย", "bTH9"),
              bullet("ให้ข้อมูล รหัสผ่าน และเอกสารที่ถูกต้องซึ่งจำเป็นต่อการตรวจสอบ", "bTH9"),
              bullet("แต่งตั้งผู้ประสานงานหนึ่งคนที่มีอำนาจประสานงานและรับรายงาน", "bTH9"),
              bullet("จัดให้พนักงานที่เกี่ยวข้องพร้อมให้ข้อมูลเมื่อจำเป็น และจัดสภาพการทำงานที่ปลอดภัย", "bTH9"),
              bullet("ระยะเวลาตาม SLA และแผนงานหยุดนับชั่วคราว หากความล่าช้าเกิดจากผู้ว่าจ้างหรือบุคคลภายนอกของผู้ว่าจ้าง", "bTH9"),
            ]
          ),

          // 9. Confidentiality & PDPA
          headerRow("9. Confidentiality & Data Protection (PDPA)", "9. การรักษาความลับและการคุ้มครองข้อมูลส่วนบุคคล"),
          sectionRow(
            [
              bullet("Both parties shall keep confidential information (including passwords, system details, audit findings, and business information) strictly confidential, use it only for this agreement, during the term and for two (2) years after", "bEN10"),
              bullet("Audit reports are for the Client’s internal use; the Provider will not disclose them to third parties without written consent", "bEN10"),
              bullet("Both parties shall comply with the Personal Data Protection Act B.E. 2562 (2019); the Provider accesses personal data (including CCTV footage) only as necessary for the audit and will not copy or retain it beyond the engagement", "bEN10"),
            ],
            [
              bullet("ทั้งสองฝ่ายต้องรักษาข้อมูลอันเป็นความลับ (รวมถึงรหัสผ่าน รายละเอียดระบบ ผลการตรวจสอบ และข้อมูลทางธุรกิจ) โดยใช้เพื่อข้อตกลงนี้เท่านั้น ตลอดอายุสัญญาและอีก 2 ปีหลังสิ้นสุด", "bTH10"),
              bullet("รายงานผลการตรวจสอบใช้ภายในองค์กรของผู้ว่าจ้างเท่านั้น ผู้ให้บริการจะไม่เปิดเผยต่อบุคคลภายนอกโดยไม่ได้รับความยินยอมเป็นลายลักษณ์อักษร", "bTH10"),
              bullet("ทั้งสองฝ่ายต้องปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 ผู้ให้บริการเข้าถึงข้อมูลส่วนบุคคล (รวมถึงภาพจากกล้องวงจรปิด) เท่าที่จำเป็นต่อการตรวจสอบ และจะไม่คัดลอกหรือเก็บไว้หลังสิ้นสุดงาน", "bTH10"),
            ]
          ),

          // 10. Limitation of liability
          headerRow("10. Limitation of Liability", "10. ข้อจำกัดความรับผิด"),
          sectionRow(
            [
              bullet("The Provider’s total liability under this agreement is limited to the total fees actually paid (45,000 THB)", "bEN11"),
              bullet("Neither party is liable for indirect, incidental, or consequential damages, including loss of profits, business, or data", "bEN11"),
              bullet("The audit is an assessment based on information available at the time of inspection and does not guarantee that systems are free of all faults or security risks", "bEN11"),
              bullet("Nothing in this section limits liability for fraud, gross negligence, or willful misconduct", "bEN11"),
            ],
            [
              bullet("ความรับผิดรวมของผู้ให้บริการภายใต้ข้อตกลงนี้จำกัดไม่เกินค่าบริการที่ได้รับชำระจริง (45,000 บาท)", "bTH11"),
              bullet("ทั้งสองฝ่ายไม่ต้องรับผิดต่อความเสียหายทางอ้อม ความเสียหายต่อเนื่อง รวมถึงการสูญเสียกำไร ธุรกิจ หรือข้อมูล", "bTH11"),
              bullet("การตรวจสอบเป็นการประเมินตามข้อมูล ณ เวลาที่ตรวจ ไม่เป็นการรับประกันว่าระบบปราศจากข้อบกพร่องหรือความเสี่ยงด้านความปลอดภัยทั้งหมด", "bTH11"),
              bullet("ข้อนี้ไม่จำกัดความรับผิดกรณีฉ้อฉล ประมาทเลินเล่ออย่างร้ายแรง หรือจงใจกระทำผิด", "bTH11"),
            ]
          ),

          // 11. General provisions
          headerRow("11. General Provisions", "11. ข้อกำหนดทั่วไป"),
          sectionRow(
            [
              bullet("Force majeure: neither party is liable for delay or failure caused by events beyond reasonable control (storm, flood, fire, power or telecom failure, government action); obligations resume when the event ends", "bEN12"),
              bullet("Notices & escalation: each party appoints a contact person; formal notices must be in writing by email — Provider: f2coltd@gmail.com, Client: [________________]", "bEN12"),
              bullet("Independent contractor: the Provider acts as an independent contractor; nothing in this agreement creates employment, partnership, or agency", "bEN12"),
              bullet("Entire agreement: this document is the entire agreement; amendments must be in writing signed by both parties; invalid provisions do not affect the remainder; no assignment without prior written consent", "bEN12"),
            ],
            [
              bullet("เหตุสุดวิสัย: ทั้งสองฝ่ายไม่ต้องรับผิดต่อความล่าช้าหรือการไม่สามารถปฏิบัติตามสัญญาอันเกิดจากเหตุการณ์ที่อยู่นอกเหนือการควบคุม (พายุ น้ำท่วม ไฟไหม้ ไฟฟ้าหรือระบบสื่อสารขัดข้อง การกระทำของรัฐ) โดยกลับมาปฏิบัติตามเมื่อเหตุการณ์สิ้นสุด", "bTH12"),
              bullet("การแจ้งและการประสานงาน: แต่ละฝ่ายแต่งตั้งผู้ติดต่อ การแจ้งอย่างเป็นทางการต้องทำเป็นลายลักษณ์อักษรทางอีเมล — ผู้ให้บริการ: f2coltd@gmail.com ผู้ว่าจ้าง: [________________]", "bTH12"),
              bullet("ผู้รับจ้างอิสระ: ผู้ให้บริการปฏิบัติงานในฐานะผู้รับจ้างอิสระ ข้อตกลงนี้ไม่ก่อให้เกิดการจ้างแรงงาน ห้างหุ้นส่วน หรือตัวแทน", "bTH12"),
              bullet("ความสมบูรณ์ของสัญญา: เอกสารนี้เป็นข้อตกลงทั้งหมดระหว่างคู่สัญญา การแก้ไขต้องทำเป็นลายลักษณ์อักษรและลงนามทั้งสองฝ่าย ข้อที่เป็นโมฆะไม่กระทบข้ออื่น ห้ามโอนสิทธิโดยไม่ได้รับความยินยอมล่วงหน้าเป็นลายลักษณ์อักษร", "bTH12"),
            ]
          ),

          // 12. Governing law & jurisdiction
          headerRow("12. Governing Law, Jurisdiction & Service Area", "12. กฎหมายที่ใช้บังคับ เขตอำนาจศาล และพื้นที่ให้บริการ"),
          sectionRow(
            [
              bullet("This agreement is governed by and construed under the laws of the Kingdom of Thailand only", "bEN8"),
              bullet("Any dispute shall be submitted exclusively to the court with jurisdiction over Koh Samui, Surat Thani Province (Koh Samui Provincial Court)", "bEN8"),
              bullet("Service area: the Client’s property on Koh Samui only; no services are provided outside Koh Samui under this agreement", "bEN8"),
              bullet("In case of any inconsistency between the English and Thai text, the Thai version shall prevail", "bEN8"),
            ],
            [
              bullet("ข้อตกลงนี้อยู่ภายใต้บังคับและตีความตามกฎหมายแห่งราชอาณาจักรไทยเท่านั้น", "bTH8"),
              bullet("ข้อพิพาทใด ๆ ให้อยู่ในเขตอำนาจของศาลที่มีเขตอำนาจเหนือพื้นที่เกาะสมุย จังหวัดสุราษฎร์ธานี (ศาลจังหวัดเกาะสมุย) แต่เพียงศาลเดียว", "bTH8"),
              bullet("พื้นที่ให้บริการ: เฉพาะสถานประกอบการของผู้ว่าจ้างบนเกาะสมุยเท่านั้น ไม่มีการให้บริการนอกเกาะสมุยภายใต้ข้อตกลงนี้", "bTH8"),
              bullet("กรณีข้อความภาษาอังกฤษและภาษาไทยไม่ตรงกัน ให้ยึดฉบับภาษาไทยเป็นหลัก", "bTH8"),
            ]
          ),
        ],
      }),

      // Signature section — own page, styled like the section tables, with space to sign
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({ spacing: { before: 120, after: 40 }, children: [runs("This agreement is made in two (2) identical counterparts, with each party holding one counterpart of equal legal effect. IN WITNESS WHEREOF, the parties have read and understood the entire agreement and have executed it below.", { size: 19 })] }),
      new Paragraph({ spacing: { after: 120 }, children: [runs("สัญญานี้ทำขึ้นเป็นสองฉบับซึ่งมีข้อความถูกต้องตรงกัน โดยคู่สัญญาต่างยึดถือไว้ฝ่ายละหนึ่งฉบับและมีผลทางกฎหมายเท่าเทียมกัน คู่สัญญาได้อ่านและเข้าใจข้อความโดยตลอดแล้ว จึงลงลายมือชื่อไว้เป็นหลักฐาน", { size: 19 })] }),
      new Table({
        width: { size: CONTENT_W, type: WidthType.DXA },
        columnWidths: [HALF, HALF],
        rows: [
          // Header bar spanning both columns
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
              new TableCell({
                borders,
                width: { size: HALF, type: WidthType.DXA },
                margins: { top: 140, bottom: 140, left: 200, right: 200 },
                children: [
                  p("SERVICE PROVIDER / ผู้ให้บริการ", { run: { size: 17, bold: true, color: ACCENT } }),
                  p("F2 Co., Ltd. (บริษัท เอฟทู จำกัด)", { run: { size: 19, bold: true } }),
                  new Paragraph({ spacing: { after: 0 }, children: [] }),
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
              }),
              new TableCell({
                borders,
                width: { size: HALF, type: WidthType.DXA },
                margins: { top: 140, bottom: 140, left: 200, right: 200 },
                children: [
                  p("CLIENT / ผู้ว่าจ้าง", { run: { size: 17, bold: true, color: ACCENT } }),
                  p("Miskawaan Company Limited (บริษัท มิสกวัน จำกัด)", { run: { size: 19, bold: true } }),
                  new Paragraph({ spacing: { after: 0 }, children: [] }),
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
              }),
            ],
          }),
        ],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync("Miskawaan_IT_Agreement_final.docx", buffer);
  console.log("done");
});
