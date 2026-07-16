// docgen — internal document-generation service for contract-api.
// NOT exposed via Traefik; reachable only on the f2-net network at
// http://docgen:8080. Renders bilingual, branded .docx + PDF from a template
// code + merge data.
//
//   GET  /healthz    -> {status, service, templates:[...]}
//   GET  /templates  -> {templates:[...codes]}   (capability list)
//   POST /render      { template, data, watermark } -> {docx_b64, pdf_b64}
const express = require("express");
const { Packer } = require("docx");
const builders = require("./lib/builders");
const { embedFonts } = require("./lib/embed-fonts");
const { docxToPdf } = require("./lib/to-pdf");

const PORT = Number(process.env.SERVICE_PORT || 8080);
const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "docgen", templates: builders.codes() });
});

app.get("/templates", (_req, res) => {
  res.json({ templates: builders.codes() });
});

app.post("/render", async (req, res) => {
  const { template, data, watermark } = req.body || {};
  if (!template || typeof template !== "string") {
    return res.status(400).json({ error: "template is required" });
  }
  const builder = builders.get(template);
  if (!builder) {
    // No silent blank doc — unknown code is a hard 404 so contract-api and
    // callers learn immediately that no renderer exists for this template.
    return res.status(404).json({ error: `no builder for template '${template}'`, available: builders.codes() });
  }
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "data object is required" });
  }

  try {
    const doc = builder.build(data, { watermark: !!watermark });
    const rawDocx = await Packer.toBuffer(doc);
    const docx = await embedFonts(rawDocx); // mandatory Thai-font embedding
    const pdf = await docxToPdf(docx);
    res.json({
      docx_b64: docx.toString("base64"),
      pdf_b64: pdf.toString("base64"),
    });
  } catch (err) {
    console.error("[docgen] render failed:", err);
    res.status(500).json({ error: "render failed", detail: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`docgen listening on :${PORT} — templates: ${builders.codes().join(", ")}`);
});
