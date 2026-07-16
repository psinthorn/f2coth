// F2 Co., Ltd. corporate identity — the ONE place the provider's own details
// live. Merge fields never carry these; builders read them from here so every
// generated document is consistent. (Tax ID / address / notice email per the
// company registration.)
module.exports = {
  provider: {
    legal_name: "F2 Co., Ltd. (บริษัท เอฟทู จำกัด)",
    tax_id: "0845560003240",
    address: "9/38 Moo 6, Bophut, Koh Samui, Surat Thani 84320",
    notice_email: "f2coltd@gmail.com",
    website: "f2.co.th",
    tagline: "Thailand's trusted IT partner for hospitality",
  },

  // Brand palette (mirrors services/web-app tailwind config).
  brand: {
    NAVY: "1E293B",   // navy-800 primary
    NAVY9: "0F172A",  // navy-900
    ACCENT: "7C3AED", // accent purple
    LIGHT: "F8FAFC",  // navy-50
    BRD: "E2E8F0",    // navy-200
    GREY: "64748B",   // navy-500
  },

  // Embedded so Thai renders on any machine, print shop, or PDF viewer.
  font: "Noto Sans Thai",
};
