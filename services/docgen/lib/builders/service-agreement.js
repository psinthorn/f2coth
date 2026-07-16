// Builder: service-agreement
// The F2 IT System Audit Service Agreement — the production-proven skeleton
// (make_agreement.js) parameterised so every Miskawaan-specific literal is
// now a merge field read from `data`. Renders the full bilingual (EN/TH)
// 12-section agreement with letterhead, footer, party panel and signature
// page. Returns a docx `Document`.
const { Document, Paragraph, Table, TableRow, WidthType, PageBreak } = require("docx");
const k = require("../shared/docx-kit");

const nf = (n) => Number(n || 0).toLocaleString("en-US");

// Bullet list refs used by this builder.
const REFS = ["bEN2","bTH2","bEN3","bTH3","bEN4","bTH4","bEN5","bTH5","bEN6","bTH6","bEN7","bTH7","bEN8","bTH8","bEN9","bTH9","bEN10","bTH10","bEN11","bTH11","bEN12","bTH12"];

function build(data, opts = {}) {
  const watermark = !!opts.watermark;
  const client = data; // party fields live at the top level of data

  const term = data.term_months ?? 3;
  const monthly = nf(data.fee_monthly ?? 15000);
  const total = nf(data.fee_total ?? 45000);
  const wordsEn = data.fee_total_words_en || "";
  const wordsTh = data.fee_total_words_th || "";
  const callout = nf(data.callout_fee ?? 1500);
  const area = data.service_area || "Koh Samui";
  const noticeEmailClient = client.notice_email || "[________________]";
  const effective = data.effective_date || "____________________";
  const advance = (data.payment_terms || "advance") === "advance";

  const schedule = Array.isArray(data.audit_schedule) && data.audit_schedule.length
    ? data.audit_schedule
    : [];

  const scheduleBulletsEN = schedule.map((s) => k.bullet(`Month ${s.month} — ${s.scope_en}`, "bEN7"));
  scheduleBulletsEN.push(k.bullet("Weekly summary every Friday; monthly progress report at each month end", "bEN7"));
  const scheduleBulletsTH = schedule.map((s) => k.bullet(`เดือนที่ ${s.month} — ${s.scope_th}`, "bTH7"));
  scheduleBulletsTH.push(k.bullet("สรุปประจำสัปดาห์ทุกวันศุกร์ และรายงานความคืบหน้าประจำเดือนทุกสิ้นเดือน", "bTH7"));

  const feeEN = advance
    ? "Paid in advance in full upon signing; one invoice, due within 7 days of invoice date"
    : `Invoiced monthly at ${monthly} THB/month; each invoice due within 7 days of invoice date`;
  const feeTH = advance
    ? "ชำระล่วงหน้าเต็มจำนวนเมื่อลงนามสัญญา ออกใบแจ้งหนี้ครั้งเดียว ชำระภายใน 7 วันนับจากวันที่ใบแจ้งหนี้"
    : `ออกใบแจ้งหนี้รายเดือน เดือนละ ${monthly} บาท ชำระภายใน 7 วันนับจากวันที่ใบแจ้งหนี้`;

  const sectionTable = new Table({
    width: { size: k.CONTENT_W, type: WidthType.DXA },
    columnWidths: [k.HALF, k.HALF],
    rows: [
      k.headerRow("1. Purpose", "1. วัตถุประสงค์"),
      k.sectionRow(
        [k.p(`The Provider will perform an IT System Audit Service across the Client's property: assess all IT systems against best-practice standards, identify risks, deliver a full audit report with an improvement roadmap to the management team, and track progress through weekly on-site visits over the ${term}-month contract term.`, { run: k.small })],
        [k.p("ผู้ให้บริการจะดำเนินการตรวจสอบระบบไอที (IT System Audit) ทั่วทั้งสถานประกอบการของผู้ว่าจ้าง: ประเมินทุกระบบเทียบกับมาตรฐานแนวปฏิบัติที่ดี ระบุความเสี่ยง จัดทำรายงานผลการตรวจสอบฉบับสมบูรณ์พร้อมแผนปรับปรุงเสนอทีมผู้บริหาร และติดตามความคืบหน้าผ่านการเข้าปฏิบัติงานรายสัปดาห์ตลอดระยะเวลาสัญญา", { run: k.small })]
      ),

      k.headerRow("2. Services Included", "2. บริการที่รวมในค่าบริการ"),
      k.sectionRow(
        [
          k.bullet("One (1) scheduled on-site audit visit per week, up to 3 hours per visit", "bEN2"),
          k.bullet("Full IT system audit per standard checklist: network, internet, Wi-Fi, CCTV, server/NAS, backup, computers, printers, email/Microsoft 365, security & accounts", "bEN2"),
          k.bullet("Complete hardware, software, and license inventory (asset register)", "bEN2"),
          k.bullet("Risk assessment with severity levels (High / Medium / Low)", "bEN2"),
          k.bullet("Weekly summary and monthly progress report", "bEN2"),
          k.bullet("Final audit report (EN/TH) with improvement roadmap and budget estimates, presented to the management team", "bEN2"),
          k.bullet("Advisory support and coordination with ISP/vendors during the audit", "bEN2"),
        ],
        [
          k.bullet("เข้าตรวจสอบที่สถานที่สัปดาห์ละ 1 ครั้ง ครั้งละไม่เกิน 3 ชั่วโมง", "bTH2"),
          k.bullet("ตรวจสอบระบบไอทีทั้งหมดตามรายการตรวจมาตรฐาน: เครือข่าย อินเทอร์เน็ต Wi-Fi กล้องวงจรปิด (CCTV) เซิร์ฟเวอร์/NAS ระบบสำรองข้อมูล คอมพิวเตอร์ เครื่องพิมพ์ อีเมล/Microsoft 365 และความปลอดภัย", "bTH2"),
          k.bullet("จัดทำทะเบียนทรัพย์สิน: ฮาร์ดแวร์ ซอฟต์แวร์ และไลเซนส์ทั้งหมด", "bTH2"),
          k.bullet("ประเมินความเสี่ยงพร้อมระดับความรุนแรง (สูง / กลาง / ต่ำ)", "bTH2"),
          k.bullet("สรุปประจำสัปดาห์และรายงานความคืบหน้าประจำเดือน", "bTH2"),
          k.bullet("รายงานผลการตรวจสอบฉบับสมบูรณ์ (อังกฤษ/ไทย) พร้อมแผนปรับปรุงและงบประมาณโดยประมาณ นำเสนอทีมผู้บริหาร", "bTH2"),
          k.bullet("ให้คำปรึกษาและประสานงานกับ ISP/ผู้ขายอุปกรณ์ระหว่างการตรวจสอบ", "bTH2"),
        ]
      ),

      k.headerRow(`3. Audit Schedule (${term} Months)`, `3. แผนการตรวจสอบ (${term} เดือน)`),
      k.sectionRow(scheduleBulletsEN, scheduleBulletsTH),

      k.headerRow("4. Services Not Included (charged separately)", "4. บริการที่ไม่รวม (คิดค่าใช้จ่ายเพิ่ม)"),
      k.sectionRow(
        [
          k.bullet("Hardware, spare parts, equipment, and software licenses", "bEN3"),
          k.bullet("New installations and project work (e.g. network cabling, additional access points, CCTV cameras, UPS, servers) – quoted separately for approval before starting", "bEN3"),
          k.bullet("Repair and implementation of improvements identified by the audit — quoted separately for approval", "bEN3"),
          k.bullet(`Emergency on-site visits outside the scheduled visit day: ${callout} THB per call-out`, "bEN3"),
          k.bullet("Any work outside the scope in Section 2", "bEN3"),
        ],
        [
          k.bullet("ฮาร์ดแวร์ อะไหล่ อุปกรณ์ และไลเซนส์ซอฟต์แวร์", "bTH3"),
          k.bullet("งานติดตั้งใหม่และงานโครงการ (เช่น เดินสายแลน เพิ่ม Access Point กล้อง CCTV UPS เซิร์ฟเวอร์) – เสนอราคาแยกต่างหากเพื่อขออนุมัติก่อนเริ่มงาน", "bTH3"),
          k.bullet("งานซ่อมแซมและดำเนินการปรับปรุงตามผลการตรวจสอบ — เสนอราคาแยกเพื่อขออนุมัติ", "bTH3"),
          k.bullet(`เรียกเข้าปฏิบัติงานฉุกเฉินนอกวันนัดหมาย: ครั้งละ ${callout} บาท`, "bTH3"),
          k.bullet("งานอื่นใดนอกเหนือขอบเขตในข้อ 2", "bTH3"),
        ]
      ),

      k.headerRow("5. Fees & Payment", "5. ค่าบริการและการชำระเงิน"),
      k.sectionRow(
        [
          k.bullet(`Total service fee: ${total} THB${wordsEn ? ` (${wordsEn})` : ""} — special ${term}-month package price (${monthly} THB × ${term} months)`, "bEN4"),
          k.bullet(feeEN, "bEN4"),
          k.bullet("Service begins on the effective date after payment is received", "bEN4"),
          k.bullet("Fee excludes hardware, parts, licenses, and project work (Section 4)", "bEN4"),
        ],
        [
          k.bullet(`ค่าบริการรวมทั้งสิ้น: ${total} บาท${wordsTh ? ` (${wordsTh})` : ""} — ราคาพิเศษแบบแพ็กเกจ ${term} เดือน (${monthly} บาท × ${term} เดือน)`, "bTH4"),
          k.bullet(feeTH, "bTH4"),
          k.bullet("เริ่มให้บริการตามวันที่เริ่มสัญญาหลังจากได้รับชำระเงินแล้ว", "bTH4"),
          k.bullet("ค่าบริการไม่รวมฮาร์ดแวร์ อะไหล่ ไลเซนส์ และงานโครงการ (ข้อ 4)", "bTH4"),
        ]
      ),

      k.headerRow("6. Term & Termination", "6. ระยะเวลาและการยกเลิก"),
      k.sectionRow(
        [
          k.bullet(`Initial term: ${term} months from the effective date above`, "bEN5"),
          k.bullet("After the initial term, the agreement renews automatically month-to-month", "bEN5"),
          k.bullet("After the initial term, either party may terminate with thirty (30) days' written notice", "bEN5"),
          k.bullet(`As this is a special ${term}-month package price paid in advance, the fee is non-refundable in all cases`, "bEN5"),
          k.bullet(`Renewal months are invoiced monthly at ${monthly} THB/month`, "bEN5"),
        ],
        [
          k.bullet(`ระยะเวลาเริ่มต้น: ${term} เดือน นับจากวันที่เริ่มสัญญาข้างต้น`, "bTH5"),
          k.bullet("เมื่อครบกำหนด สัญญาต่ออายุอัตโนมัติแบบรายเดือน", "bTH5"),
          k.bullet("หลังครบระยะเวลาเริ่มต้น ฝ่ายใดฝ่ายหนึ่งยกเลิกได้โดยแจ้งเป็นลายลักษณ์อักษรล่วงหน้า 30 วัน", "bTH5"),
          k.bullet(`เนื่องจากเป็นราคาพิเศษแบบแพ็กเกจ ${term} เดือนชำระล่วงหน้า ค่าบริการไม่สามารถขอคืนได้ในทุกกรณี`, "bTH5"),
          k.bullet(`เดือนต่ออายุออกใบแจ้งหนี้รายเดือน เดือนละ ${monthly} บาท`, "bTH5"),
        ]
      ),

      k.headerRow("7. Service Levels (SLA)", "7. ระดับการให้บริการ (SLA)"),
      k.sectionRow(
        [
          k.bullet("Service hours: Monday–Saturday, 09:00–18:00 (business hours)", "bEN6"),
          k.bullet("Critical (whole property affected, e.g. internet/server/CCTV recording down): remote response within 2 business hours; on-site same or next business day", "bEN6"),
          k.bullet("High (one area or several users affected): remote response within 4 business hours", "bEN6"),
          k.bullet("Medium / Low (single user, requests): handled at the next weekly visit", "bEN6"),
          k.bullet("Issues must be reported via the agreed contact channel; response time counts from the time of report", "bEN6"),
          k.bullet("Excluded from SLA: ISP outages, power failures, hardware delivery lead times, and third-party vendor delays", "bEN6"),
          k.bullet("SLA performance is reported in the monthly summary", "bEN6"),
        ],
        [
          k.bullet("เวลาให้บริการ: วันจันทร์–เสาร์ เวลา 09:00–18:00 น. (เวลาทำการ)", "bTH6"),
          k.bullet("วิกฤต (กระทบทั้งสถานประกอบการ เช่น อินเทอร์เน็ต/เซิร์ฟเวอร์/การบันทึก CCTV ล่ม): ตอบสนองทางไกลภายใน 2 ชั่วโมงทำการ เข้าหน้างานภายในวันเดียวกันหรือวันทำการถัดไป", "bTH6"),
          k.bullet("สูง (กระทบหนึ่งพื้นที่หรือผู้ใช้หลายคน): ตอบสนองทางไกลภายใน 4 ชั่วโมงทำการ", "bTH6"),
          k.bullet("กลาง / ต่ำ (ผู้ใช้รายเดียว หรืองานร้องขอทั่วไป): ดำเนินการในการเข้าปฏิบัติงานรายสัปดาห์ครั้งถัดไป", "bTH6"),
          k.bullet("ต้องแจ้งปัญหาผ่านช่องทางติดต่อที่ตกลงกัน โดยนับเวลาตอบสนองจากเวลาที่แจ้ง", "bTH6"),
          k.bullet("ไม่นับรวมใน SLA: เหตุขัดข้องจาก ISP ไฟฟ้าดับ ระยะเวลารออะไหล่/อุปกรณ์ และความล่าช้าจากผู้ให้บริการภายนอก", "bTH6"),
          k.bullet("รายงานผล SLA ในสรุปประจำเดือน", "bTH6"),
        ]
      ),

      k.headerRow("8. Client Obligations", "8. หน้าที่ของผู้ว่าจ้าง"),
      k.sectionRow(
        [
          k.bullet("Provide access to premises, systems, and equipment during scheduled visits", "bEN9"),
          k.bullet("Provide accurate information, credentials, and documentation required for the audit", "bEN9"),
          k.bullet("Appoint one contact person authorised to coordinate work and receive reports", "bEN9"),
          k.bullet("Ensure relevant staff are available when needed and provide safe working conditions", "bEN9"),
          k.bullet("SLA and schedule timelines are paused for delays caused by the Client or the Client's third parties", "bEN9"),
        ],
        [
          k.bullet("จัดให้เข้าถึงสถานที่ ระบบ และอุปกรณ์ในวันเข้าปฏิบัติงานตามนัดหมาย", "bTH9"),
          k.bullet("ให้ข้อมูล รหัสผ่าน และเอกสารที่ถูกต้องซึ่งจำเป็นต่อการตรวจสอบ", "bTH9"),
          k.bullet("แต่งตั้งผู้ประสานงานหนึ่งคนที่มีอำนาจประสานงานและรับรายงาน", "bTH9"),
          k.bullet("จัดให้พนักงานที่เกี่ยวข้องพร้อมให้ข้อมูลเมื่อจำเป็น และจัดสภาพการทำงานที่ปลอดภัย", "bTH9"),
          k.bullet("ระยะเวลาตาม SLA และแผนงานหยุดนับชั่วคราว หากความล่าช้าเกิดจากผู้ว่าจ้างหรือบุคคลภายนอกของผู้ว่าจ้าง", "bTH9"),
        ]
      ),

      k.headerRow("9. Confidentiality & Data Protection (PDPA)", "9. การรักษาความลับและการคุ้มครองข้อมูลส่วนบุคคล"),
      k.sectionRow(
        [
          k.bullet("Both parties shall keep confidential information (including passwords, system details, audit findings, and business information) strictly confidential, use it only for this agreement, during the term and for two (2) years after", "bEN10"),
          k.bullet("Audit reports are for the Client's internal use; the Provider will not disclose them to third parties without written consent", "bEN10"),
          k.bullet("Both parties shall comply with the Personal Data Protection Act B.E. 2562 (2019); the Provider accesses personal data (including CCTV footage) only as necessary for the audit and will not copy or retain it beyond the engagement", "bEN10"),
        ],
        [
          k.bullet("ทั้งสองฝ่ายต้องรักษาข้อมูลอันเป็นความลับ (รวมถึงรหัสผ่าน รายละเอียดระบบ ผลการตรวจสอบ และข้อมูลทางธุรกิจ) โดยใช้เพื่อข้อตกลงนี้เท่านั้น ตลอดอายุสัญญาและอีก 2 ปีหลังสิ้นสุด", "bTH10"),
          k.bullet("รายงานผลการตรวจสอบใช้ภายในองค์กรของผู้ว่าจ้างเท่านั้น ผู้ให้บริการจะไม่เปิดเผยต่อบุคคลภายนอกโดยไม่ได้รับความยินยอมเป็นลายลักษณ์อักษร", "bTH10"),
          k.bullet("ทั้งสองฝ่ายต้องปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 ผู้ให้บริการเข้าถึงข้อมูลส่วนบุคคล (รวมถึงภาพจากกล้องวงจรปิด) เท่าที่จำเป็นต่อการตรวจสอบ และจะไม่คัดลอกหรือเก็บไว้หลังสิ้นสุดงาน", "bTH10"),
        ]
      ),

      k.headerRow("10. Limitation of Liability", "10. ข้อจำกัดความรับผิด"),
      k.sectionRow(
        [
          k.bullet(`The Provider's total liability under this agreement is limited to the total fees actually paid (${total} THB)`, "bEN11"),
          k.bullet("Neither party is liable for indirect, incidental, or consequential damages, including loss of profits, business, or data", "bEN11"),
          k.bullet("The audit is an assessment based on information available at the time of inspection and does not guarantee that systems are free of all faults or security risks", "bEN11"),
          k.bullet("Nothing in this section limits liability for fraud, gross negligence, or willful misconduct", "bEN11"),
        ],
        [
          k.bullet(`ความรับผิดรวมของผู้ให้บริการภายใต้ข้อตกลงนี้จำกัดไม่เกินค่าบริการที่ได้รับชำระจริง (${total} บาท)`, "bTH11"),
          k.bullet("ทั้งสองฝ่ายไม่ต้องรับผิดต่อความเสียหายทางอ้อม ความเสียหายต่อเนื่อง รวมถึงการสูญเสียกำไร ธุรกิจ หรือข้อมูล", "bTH11"),
          k.bullet("การตรวจสอบเป็นการประเมินตามข้อมูล ณ เวลาที่ตรวจ ไม่เป็นการรับประกันว่าระบบปราศจากข้อบกพร่องหรือความเสี่ยงด้านความปลอดภัยทั้งหมด", "bTH11"),
          k.bullet("ข้อนี้ไม่จำกัดความรับผิดกรณีฉ้อฉล ประมาทเลินเล่ออย่างร้ายแรง หรือจงใจกระทำผิด", "bTH11"),
        ]
      ),

      k.headerRow("11. General Provisions", "11. ข้อกำหนดทั่วไป"),
      k.sectionRow(
        [
          k.bullet("Force majeure: neither party is liable for delay or failure caused by events beyond reasonable control (storm, flood, fire, power or telecom failure, government action); obligations resume when the event ends", "bEN12"),
          k.bullet(`Notices & escalation: each party appoints a contact person; formal notices must be in writing by email — Provider: ${k.F2.provider.notice_email}, Client: ${noticeEmailClient}`, "bEN12"),
          k.bullet("Independent contractor: the Provider acts as an independent contractor; nothing in this agreement creates employment, partnership, or agency", "bEN12"),
          k.bullet("Entire agreement: this document is the entire agreement; amendments must be in writing signed by both parties; invalid provisions do not affect the remainder; no assignment without prior written consent", "bEN12"),
        ],
        [
          k.bullet("เหตุสุดวิสัย: ทั้งสองฝ่ายไม่ต้องรับผิดต่อความล่าช้าหรือการไม่สามารถปฏิบัติตามสัญญาอันเกิดจากเหตุการณ์ที่อยู่นอกเหนือการควบคุม (พายุ น้ำท่วม ไฟไหม้ ไฟฟ้าหรือระบบสื่อสารขัดข้อง การกระทำของรัฐ) โดยกลับมาปฏิบัติตามเมื่อเหตุการณ์สิ้นสุด", "bTH12"),
          k.bullet(`การแจ้งและการประสานงาน: แต่ละฝ่ายแต่งตั้งผู้ติดต่อ การแจ้งอย่างเป็นทางการต้องทำเป็นลายลักษณ์อักษรทางอีเมล — ผู้ให้บริการ: ${k.F2.provider.notice_email} ผู้ว่าจ้าง: ${noticeEmailClient}`, "bTH12"),
          k.bullet("ผู้รับจ้างอิสระ: ผู้ให้บริการปฏิบัติงานในฐานะผู้รับจ้างอิสระ ข้อตกลงนี้ไม่ก่อให้เกิดการจ้างแรงงาน ห้างหุ้นส่วน หรือตัวแทน", "bTH12"),
          k.bullet("ความสมบูรณ์ของสัญญา: เอกสารนี้เป็นข้อตกลงทั้งหมดระหว่างคู่สัญญา การแก้ไขต้องทำเป็นลายลักษณ์อักษรและลงนามทั้งสองฝ่าย ข้อที่เป็นโมฆะไม่กระทบข้ออื่น ห้ามโอนสิทธิโดยไม่ได้รับความยินยอมล่วงหน้าเป็นลายลักษณ์อักษร", "bTH12"),
        ]
      ),

      k.headerRow("12. Governing Law, Jurisdiction & Service Area", "12. กฎหมายที่ใช้บังคับ เขตอำนาจศาล และพื้นที่ให้บริการ"),
      k.sectionRow(
        [
          k.bullet("This agreement is governed by and construed under the laws of the Kingdom of Thailand only", "bEN8"),
          k.bullet(`Any dispute shall be submitted exclusively to the court with jurisdiction over ${area}, Surat Thani Province`, "bEN8"),
          k.bullet(`Service area: the Client's property on ${area} only; no services are provided outside ${area} under this agreement`, "bEN8"),
          k.bullet("In case of any inconsistency between the English and Thai text, the Thai version shall prevail", "bEN8"),
        ],
        [
          k.bullet("ข้อตกลงนี้อยู่ภายใต้บังคับและตีความตามกฎหมายแห่งราชอาณาจักรไทยเท่านั้น", "bTH8"),
          k.bullet(`ข้อพิพาทใด ๆ ให้อยู่ในเขตอำนาจของศาลที่มีเขตอำนาจเหนือพื้นที่ ${area} จังหวัดสุราษฎร์ธานี แต่เพียงศาลเดียว`, "bTH8"),
          k.bullet(`พื้นที่ให้บริการ: เฉพาะสถานประกอบการของผู้ว่าจ้างในพื้นที่ ${area} เท่านั้น ไม่มีการให้บริการนอกพื้นที่ ${area} ภายใต้ข้อตกลงนี้`, "bTH8"),
          k.bullet("กรณีข้อความภาษาอังกฤษและภาษาไทยไม่ตรงกัน ให้ยึดฉบับภาษาไทยเป็นหลัก", "bTH8"),
        ]
      ),
    ],
  });

  return new Document({
    styles: k.documentStyles,
    numbering: k.numberingConfig(REFS),
    sections: [{
      properties: k.pageProps,
      headers: { default: k.makeHeader({ watermark }) },
      footers: { default: k.makeFooter() },
      children: [
        ...k.titleBlock({
          titleEn: "IT SYSTEM AUDIT SERVICE AGREEMENT",
          titleTh: "ข้อตกลงบริการตรวจสอบระบบไอที – ขอบเขตงาน",
          metaLine: `Scope of Work  ·  Doc No. ${data.doc_no || "________"}  ·  Version ${data.template_version || "1.0"}`,
        }),
        k.partyPanel(client),
        new Paragraph({ spacing: { before: 120, after: 200 }, children: [k.runs(`Effective Date / วันที่เริ่มสัญญา:   ${effective}`, { size: 20, bold: true })] }),
        sectionTable,
        ...k.signatureBlock({ PageBreak }, client),
      ],
    }],
  });
}

module.exports = { build };
