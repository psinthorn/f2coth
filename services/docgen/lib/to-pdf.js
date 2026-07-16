// Convert a .docx buffer to PDF using LibreOffice headless. Fidelity matters
// for a signed legal document, so we render with the same engine an office
// user would. Runs in the same container (soffice installed in the image).
//
// LibreOffice can't stream: it needs a real input file and writes the PDF into
// an output directory. We use a per-call temp dir under os.tmpdir() and clean
// it up afterwards. A single soffice profile lock can serialise concurrent
// runs, so we give each invocation its own -env:UserInstallation profile.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const SOFFICE = process.env.SOFFICE_BIN || "soffice";
const TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS || 60000);

function docxToPdf(docxBuffer) {
  return new Promise((resolve, reject) => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "docgen-"));
    const inPath = path.join(workdir, "doc.docx");
    const outPath = path.join(workdir, "doc.pdf");
    const profile = path.join(workdir, "profile");

    fs.writeFileSync(inPath, docxBuffer);

    const args = [
      "--headless",
      "--norestore",
      `-env:UserInstallation=file://${profile}`,
      "--convert-to", "pdf:writer_pdf_Export",
      "--outdir", workdir,
      inPath,
    ];

    execFile(SOFFICE, args, { timeout: TIMEOUT_MS }, (err) => {
      try {
        if (err) {
          cleanup(workdir);
          return reject(new Error(`libreoffice conversion failed: ${err.message}`));
        }
        if (!fs.existsSync(outPath)) {
          cleanup(workdir);
          return reject(new Error("libreoffice produced no PDF"));
        }
        const pdf = fs.readFileSync(outPath);
        cleanup(workdir);
        resolve(pdf);
      } catch (e) {
        cleanup(workdir);
        reject(e);
      }
    });
  });
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

module.exports = { docxToPdf };
