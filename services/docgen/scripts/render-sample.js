// Local smoke test: render both templates to ./scripts/out without needing the
// HTTP server or LibreOffice. Verifies the builders + font embedding produce a
// valid .docx. Run: `node scripts/render-sample.js`
// (PDF conversion is skipped here since it needs soffice; it runs in-container.)
const fs = require("fs");
const path = require("path");
const { Packer } = require("docx");
const builders = require("../lib/builders");
const { embedFonts } = require("../lib/embed-fonts");

const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const party = {
  legal_name_en: "Miskawaan Company Limited",
  legal_name_th: "บริษัท มิสกวัน จำกัด",
  brand_name: "Miskawaan Beachfront Villas (MHG Villas)",
  tax_id: "0105549033541",
  address: "67/28 Moo 1, Maenam, Koh Samui, Surat Thani 84330",
  notice_email: "ops@miskawaan.example",
};

const samples = [
  {
    template: "service-agreement",
    watermark: true,
    data: {
      ...party,
      doc_no: "F2-AGR-2026-001",
      template_version: "1.0",
      effective_date: "1 August 2026",
      term_months: 3,
      fee_monthly: 15000,
      fee_total: 45000,
      fee_total_words_en: "forty-five thousand baht",
      fee_total_words_th: "สี่หมื่นห้าพันบาทถ้วน",
      payment_terms: "advance",
      callout_fee: 1500,
      service_area: "Koh Samui",
      audit_schedule: [
        { month: 1, scope_en: "Kickoff + Network & Wi-Fi audit", scope_th: "เริ่มโครงการ + ตรวจสอบเครือข่ายและ Wi-Fi" },
        { month: 2, scope_en: "Server/NAS + Backup + Email/M365", scope_th: "เซิร์ฟเวอร์/NAS + สำรองข้อมูล + อีเมล/M365" },
        { month: 3, scope_en: "Security + CCTV + final report", scope_th: "ความปลอดภัย + CCTV + รายงานฉบับสมบูรณ์" },
      ],
    },
  },
  {
    template: "mutual-nda",
    watermark: false,
    data: {
      ...party,
      doc_no: "F2-NDA-2026-001",
      template_version: "1.0",
      effective_date: "1 August 2026",
      term_months: 12,
      survival_years: 2,
      purpose_en: "evaluating a managed IT services engagement",
      purpose_th: "เพื่อประเมินการว่าจ้างบริการไอทีแบบครบวงจร",
      service_area: "Koh Samui",
    },
  },
];

(async () => {
  for (const s of samples) {
    const doc = builders.get(s.template).build(s.data, { watermark: s.watermark });
    const raw = await Packer.toBuffer(doc);
    const withFonts = await embedFonts(raw);
    const file = path.join(OUT, `${s.template}.docx`);
    fs.writeFileSync(file, withFonts);
    console.log(`wrote ${file} (${withFonts.length} bytes, watermark=${s.watermark})`);
  }
  console.log("OK — open the .docx files to verify branding + Thai rendering.");
})().catch((e) => { console.error(e); process.exit(1); });
