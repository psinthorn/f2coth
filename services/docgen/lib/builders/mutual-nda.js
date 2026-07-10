// Builder: mutual-nda
// A Mutual Non-Disclosure Agreement. Deliberately a DIFFERENT shape from the
// service agreement (parties + term + confidentiality + governing law, NO fee
// fields) so it proves the shared kit + registry generalise beyond one layout.
// Returns a docx `Document`.
const { Document, Paragraph, Table, TableRow, WidthType, PageBreak } = require("docx");
const k = require("../shared/docx-kit");

const REFS = ["nEN1", "nTH1", "nEN2", "nTH2", "nEN3", "nTH3", "nEN4", "nTH4", "nEN5", "nTH5"];

function build(data, opts = {}) {
  const watermark = !!opts.watermark;
  const client = data;

  const term = data.term_months ?? 12;
  const survival = data.survival_years ?? 2;
  const area = data.service_area || "Koh Samui";
  const purposeEn = data.purpose_en || "evaluating a potential IT services engagement";
  const purposeTh = data.purpose_th || "เพื่อประเมินความเป็นไปได้ในการว่าจ้างงานบริการไอที";
  const effective = data.effective_date || "____________________";

  const sectionTable = new Table({
    width: { size: k.CONTENT_W, type: WidthType.DXA },
    columnWidths: [k.HALF, k.HALF],
    rows: [
      k.headerRow("1. Purpose", "1. วัตถุประสงค์"),
      k.sectionRow(
        [k.p(`The parties wish to exchange confidential information for the purpose of ${purposeEn} (the "Purpose"). This agreement governs how each party protects the other's confidential information.`, { run: k.small })],
        [k.p(`คู่สัญญาประสงค์จะแลกเปลี่ยนข้อมูลอันเป็นความลับเพื่อวัตถุประสงค์ใน ${purposeTh} ("วัตถุประสงค์") ข้อตกลงนี้กำหนดวิธีที่แต่ละฝ่ายคุ้มครองข้อมูลอันเป็นความลับของอีกฝ่าย`, { run: k.small })]
      ),

      k.headerRow("2. Confidential Information", "2. ข้อมูลอันเป็นความลับ"),
      k.sectionRow(
        [
          k.bullet("Any non-public business, technical, financial, operational or system information disclosed by one party (Discloser) to the other (Recipient), in any form, marked or reasonably understood to be confidential", "nEN1"),
          k.bullet("Includes passwords, network diagrams, security assessments, guest/customer data, and pricing", "nEN1"),
        ],
        [
          k.bullet("ข้อมูลทางธุรกิจ เทคนิค การเงิน การดำเนินงาน หรือระบบที่ไม่เปิดเผยต่อสาธารณะซึ่งฝ่ายหนึ่ง (ผู้เปิดเผย) เปิดเผยต่ออีกฝ่าย (ผู้รับ) ไม่ว่ารูปแบบใด ที่ระบุหรือเข้าใจได้ตามสมควรว่าเป็นความลับ", "nTH1"),
          k.bullet("รวมถึงรหัสผ่าน แผนผังเครือข่าย การประเมินความปลอดภัย ข้อมูลลูกค้า/ผู้เข้าพัก และราคา", "nTH1"),
        ]
      ),

      k.headerRow("3. Obligations", "3. หน้าที่"),
      k.sectionRow(
        [
          k.bullet("Use the confidential information solely for the Purpose", "nEN2"),
          k.bullet("Protect it with at least the same care as the Recipient's own confidential information, and no less than a reasonable standard", "nEN2"),
          k.bullet("Disclose it only to employees or advisers who need to know and are bound by equivalent confidentiality", "nEN2"),
          k.bullet("Not copy or retain it beyond what the Purpose requires", "nEN2"),
        ],
        [
          k.bullet("ใช้ข้อมูลอันเป็นความลับเพื่อวัตถุประสงค์เท่านั้น", "nTH2"),
          k.bullet("คุ้มครองข้อมูลด้วยความระมัดระวังอย่างน้อยเท่ากับข้อมูลความลับของตนเอง และไม่น้อยกว่ามาตรฐานที่สมเหตุสมผล", "nTH2"),
          k.bullet("เปิดเผยเฉพาะพนักงานหรือที่ปรึกษาที่จำเป็นต้องทราบและผูกพันตามข้อกำหนดการรักษาความลับที่เทียบเท่า", "nTH2"),
          k.bullet("ไม่คัดลอกหรือเก็บรักษาเกินกว่าที่วัตถุประสงค์กำหนด", "nTH2"),
        ]
      ),

      k.headerRow("4. Exclusions", "4. ข้อยกเว้น"),
      k.sectionRow(
        [
          k.bullet("Information that is or becomes public without breach; was already known to the Recipient; is independently developed; or is lawfully received from a third party", "nEN3"),
          k.bullet("Disclosure required by law or court order, provided the Recipient gives prompt notice where permitted", "nEN3"),
        ],
        [
          k.bullet("ข้อมูลที่เป็นหรือกลายเป็นสาธารณะโดยไม่ได้ละเมิด ที่ผู้รับทราบอยู่ก่อนแล้ว ที่พัฒนาขึ้นเองโดยอิสระ หรือที่ได้รับโดยชอบด้วยกฎหมายจากบุคคลภายนอก", "nTH3"),
          k.bullet("การเปิดเผยตามที่กฎหมายหรือคำสั่งศาลกำหนด โดยผู้รับแจ้งให้ทราบโดยพลันเท่าที่ได้รับอนุญาต", "nTH3"),
        ]
      ),

      k.headerRow(`5. Term & Governing Law`, `5. ระยะเวลาและกฎหมายที่ใช้บังคับ`),
      k.sectionRow(
        [
          k.bullet(`This agreement runs for ${term} months from the effective date; confidentiality obligations survive for ${survival} years after it ends`, "nEN4"),
          k.bullet("Each party shall comply with the Personal Data Protection Act B.E. 2562 (2019)", "nEN4"),
          k.bullet(`Governed by the laws of the Kingdom of Thailand; disputes submitted to the court with jurisdiction over ${area}, Surat Thani Province`, "nEN4"),
          k.bullet("In case of inconsistency between the English and Thai text, the Thai version shall prevail", "nEN4"),
        ],
        [
          k.bullet(`ข้อตกลงนี้มีระยะเวลา ${term} เดือนนับจากวันที่เริ่มสัญญา หน้าที่รักษาความลับมีผลต่อไปอีก ${survival} ปีหลังสิ้นสุด`, "nTH4"),
          k.bullet("แต่ละฝ่ายต้องปฏิบัติตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562", "nTH4"),
          k.bullet(`อยู่ภายใต้กฎหมายแห่งราชอาณาจักรไทย ข้อพิพาทให้อยู่ในเขตอำนาจของศาลที่มีเขตอำนาจเหนือพื้นที่ ${area} จังหวัดสุราษฎร์ธานี`, "nTH4"),
          k.bullet("กรณีข้อความภาษาอังกฤษและภาษาไทยไม่ตรงกัน ให้ยึดฉบับภาษาไทยเป็นหลัก", "nTH4"),
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
          titleEn: "MUTUAL NON-DISCLOSURE AGREEMENT",
          titleTh: "ข้อตกลงการรักษาความลับร่วมกัน",
          metaLine: `Doc No. ${data.doc_no || "________"}  ·  Version ${data.template_version || "1.0"}`,
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
