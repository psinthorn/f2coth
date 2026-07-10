// Node port of embed_fonts.py — embeds Noto Sans Thai into a .docx as
// obfuscated `.odttf` streams per the OOXML embedded-font spec, so Thai text
// renders identically on any machine, print shop or PDF converter (LibreOffice
// included). This step is MANDATORY for every generated docx.
//
// The obfuscation: a random GUID per font; XOR the first 32 bytes of the TTF
// against the 16-byte key derived from the GUID, in reverse-nibble order.
// Faithful to the reference Python (data[i] ^= key[15 - (i % 16)] for i<32).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");
const F2 = require("../config/f2");

const FONT_NAME = F2.font; // "Noto Sans Thai"
const ASSETS = path.join(__dirname, "..", "assets");
const FONTS = [
  { style: "Regular", file: "NotoSansThai-Regular.ttf", tag: "embedRegular" },
  { style: "Bold", file: "NotoSansThai-Bold.ttf", tag: "embedBold" },
];

const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function obfuscate(ttfBytes, guid) {
  const key = Buffer.from(guid.replace(/-/g, ""), "hex"); // 16 bytes
  const data = Buffer.from(ttfBytes);
  for (let i = 0; i < 32; i++) data[i] ^= key[15 - (i % 16)];
  return data;
}

const EMPTY_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

// docxBuffer -> Promise<Buffer> with fonts embedded.
async function embedFonts(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);

  let fontTable = await readText(zip, "word/fontTable.xml");
  let settings = await readText(zip, "word/settings.xml");
  let ctypes = await readText(zip, "[Content_Types].xml");
  let ftRels = (await readText(zip, "word/_rels/fontTable.xml.rels")) || EMPTY_RELS;

  // docx should always emit fontTable + settings + content types; guard anyway.
  if (!fontTable) fontTable = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:fonts>';
  if (!settings) settings = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:settings>';

  let embeds = "";
  let relsFrag = "";
  const odttf = [];
  FONTS.forEach((f, idx) => {
    const n = idx + 1;
    const guid = crypto.randomUUID().toUpperCase();
    const rid = `rIdFont${n}`;
    const ttf = fs.readFileSync(path.join(ASSETS, f.file));
    odttf.push({ name: `word/fonts/font${n}.odttf`, data: obfuscate(ttf, guid) });
    embeds += `<w:${f.tag} r:id="${rid}" w:fontKey="{${guid}}"/>`;
    relsFrag += `<Relationship Id="${rid}" Type="${R_NS}/font" Target="fonts/font${n}.odttf"/>`;
  });

  // 1. fontTable.xml — docx emits an empty SELF-CLOSING <w:fonts .../>; expand
  // it to an open/close pair so we can insert font entries. Then ensure the
  // r: namespace on the root element.
  fontTable = fontTable.replace(/(<w:fonts\b[^>]*?)\s*\/>/, "$1></w:fonts>");
  const rootTag = (fontTable.match(/<w:fonts[^>]*?>/) || [""])[0];
  if (!/xmlns:r=/.test(rootTag)) {
    fontTable = fontTable.replace("<w:fonts ", `<w:fonts xmlns:r="${R_NS}" `);
  }
  const entry =
    `<w:font w:name="${FONT_NAME}">` +
    `<w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/>` +
    `${embeds}</w:font>`;
  const selfClosing = new RegExp(`<w:font w:name="${escapeRe(FONT_NAME)}"\\s*/>`);
  const openClose = new RegExp(`(<w:font w:name="${escapeRe(FONT_NAME)}">)([\\s\\S]*?)(</w:font>)`);
  if (selfClosing.test(fontTable)) {
    fontTable = fontTable.replace(selfClosing, entry);
  } else if (openClose.test(fontTable)) {
    fontTable = fontTable.replace(openClose, (m, a, b, c) => a + b + embeds + c);
  } else {
    fontTable = fontTable.replace("</w:fonts>", entry + "</w:fonts>");
  }

  // 2. fontTable rels (root may be self-closing).
  if (ftRels.includes("</Relationships>")) {
    ftRels = ftRels.replace("</Relationships>", relsFrag + "</Relationships>");
  } else {
    ftRels = ftRels.replace(/(<Relationships[^>]*)\/>/, `$1>${relsFrag}</Relationships>`);
  }

  // 3. content types — declare the odttf default.
  if (!ctypes.includes('Extension="odttf"')) {
    ctypes = ctypes.replace(
      "</Types>",
      '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/></Types>'
    );
  }

  // 4. settings — embedTrueTypeFonts must come early.
  const flag = "<w:embedTrueTypeFonts/><w:saveSubsetFonts/>";
  if (!settings.includes("embedTrueTypeFonts")) {
    if (settings.includes("<w:displayBackgroundShape/>")) {
      settings = settings.replace("<w:displayBackgroundShape/>", "<w:displayBackgroundShape/>" + flag);
    } else {
      settings = settings.replace(/(<w:settings[^>]*>)/, `$1${flag}`);
    }
  }

  // 5. write everything back.
  zip.file("word/fontTable.xml", fontTable);
  zip.file("word/settings.xml", settings);
  zip.file("[Content_Types].xml", ctypes);
  zip.file("word/_rels/fontTable.xml.rels", ftRels);
  odttf.forEach((f) => zip.file(f.name, f.data));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function readText(zip, name) {
  const f = zip.file(name);
  return f ? f.async("string") : null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { embedFonts };
