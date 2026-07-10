#!/usr/bin/env python3
"""Embed TTF fonts into a .docx (obfuscated odttf per OOXML spec)."""
import zipfile, shutil, uuid, sys, re, os

SRC = sys.argv[1] if len(sys.argv) > 1 else "Miskawaan_IT_Agreement_final.docx"
DST = sys.argv[2] if len(sys.argv) > 2 else "Miskawaan_IT_Agreement_embedded.docx"
FONT_NAME = "Noto Sans Thai"
HOME = os.path.expanduser("~")
FONTS = [
    ("Regular", f"{HOME}/.fonts/NotoSansThai-Regular.ttf", "embedRegular"),
    ("Bold", f"{HOME}/.fonts/NotoSansThai-Bold.ttf", "embedBold"),
]

def obfuscate(ttf_bytes, guid):
    key = bytes.fromhex(guid.replace("-", ""))
    data = bytearray(ttf_bytes)
    for i in range(32):
        data[i] ^= key[15 - (i % 16)]
    return bytes(data)

shutil.copy(SRC, DST)

zin = zipfile.ZipFile(SRC)
names = zin.namelist()

font_table = zin.read("word/fontTable.xml").decode("utf-8")
settings = zin.read("word/settings.xml").decode("utf-8")
ctypes = zin.read("[Content_Types].xml").decode("utf-8")
try:
    ft_rels = zin.read("word/_rels/fontTable.xml.rels").decode("utf-8")
except KeyError:
    ft_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               '</Relationships>')

# 1. Build odttf payloads + XML fragments
embeds, rels_frag, odttf_files = "", "", []
for idx, (style, path, tag) in enumerate(FONTS, start=1):
    guid = str(uuid.uuid4()).upper()
    rid = f"rIdFont{idx}"
    with open(path, "rb") as f:
        odttf_files.append((f"word/fonts/font{idx}.odttf", obfuscate(f.read(), guid)))
    embeds += f'<w:{tag} r:id="{rid}" w:fontKey="{{{guid}}}"/>'
    rels_frag += (f'<Relationship Id="{rid}" '
                  f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" '
                  f'Target="fonts/font{idx}.odttf"/>')

# 2. fontTable.xml — ensure r namespace on root
if "xmlns:r=" not in font_table.split(">", 2)[1]:
    font_table = font_table.replace(
        "<w:fonts ",
        '<w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
        1)
entry = (f'<w:font w:name="{FONT_NAME}">'
         f'<w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/>'
         f'{embeds}</w:font>')
if f'w:name="{FONT_NAME}"' in font_table:
    # insert embeds into existing entry
    font_table = re.sub(
        r'(<w:font w:name="' + FONT_NAME + r'">)(.*?)(</w:font>)',
        lambda m: m.group(1) + m.group(2) + embeds + m.group(3),
        font_table, count=1, flags=re.S)
else:
    font_table = font_table.replace("</w:fonts>", entry + "</w:fonts>")

# 3. rels (root may be self-closing)
if "</Relationships>" in ft_rels:
    ft_rels = ft_rels.replace("</Relationships>", rels_frag + "</Relationships>")
else:
    ft_rels = re.sub(r"(<Relationships[^>]*)/>", r"\1>" + rels_frag + "</Relationships>", ft_rels, count=1)

# 4. content types
if 'Extension="odttf"' not in ctypes:
    ctypes = ctypes.replace(
        "</Types>",
        '<Default Extension="odttf" '
        'ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/></Types>')

# 5. settings — embedTrueTypeFonts must come early (after displayBackgroundShape if present)
flag = "<w:embedTrueTypeFonts/><w:saveSubsetFonts/>"
if "embedTrueTypeFonts" not in settings:
    if "<w:displayBackgroundShape/>" in settings:
        settings = settings.replace("<w:displayBackgroundShape/>", "<w:displayBackgroundShape/>" + flag, 1)
    else:
        settings = re.sub(r"(<w:settings[^>]*>)", r"\1" + flag, settings, count=1)

# 6. rewrite zip
with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
    for name in names:
        if name == "word/fontTable.xml":
            zout.writestr(name, font_table)
        elif name == "word/settings.xml":
            zout.writestr(name, settings)
        elif name == "[Content_Types].xml":
            zout.writestr(name, ctypes)
        elif name == "word/_rels/fontTable.xml.rels":
            zout.writestr(name, ft_rels)
        else:
            zout.writestr(name, zin.read(name))
    if "word/_rels/fontTable.xml.rels" not in names:
        zout.writestr("word/_rels/fontTable.xml.rels", ft_rels)
    for fname, payload in odttf_files:
        zout.writestr(fname, payload)

zin.close()
print("embedded ->", DST)
