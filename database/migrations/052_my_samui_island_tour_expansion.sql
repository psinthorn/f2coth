-- =============================================================
-- 052_my_samui_island_tour_expansion.sql
-- Three related changes flagged by the F2 team while auditing
-- My Samui Island Tour via the MCP servers:
--
--   1) Add a new service module `corporate-identity` (marketing
--      category, is_published=FALSE). F2 delivers full brand-system
--      work — logo, brand book, print + digital assets — but the
--      catalogue didn't surface it.
--
--   2) Update `my-samui-island-tour` customer to reference every
--      service F2 actually delivers to them: domain umbrella, DNS,
--      web hosting, business email, website development, IT
--      management, iACC SaaS, corporate identity.
--
--   3) Draft a case study for My Samui Island Tour (unpublished).
--      Content is a first pass — SEO + Copywriter agent should polish
--      before is_published flips to TRUE. Hero image + real quote also
--      pending. Serves as a strong "F2 as full-stack partner"
--      narrative because scope covers branding + product + ops.
-- =============================================================

-- ---------- 1. corporate-identity service ----------
INSERT INTO services (slug, title, short_summary, description, icon, category, sort_order, is_published)
VALUES
    ('corporate-identity',
     '{"en":"Corporate Identity & Brand Design","th":"อัตลักษณ์องค์กรและออกแบบแบรนด์"}'::jsonb,
     '{"en":"Logo, brand book, and the print + digital asset library your business runs on — consistent across every touchpoint.","th":"โลโก้ brand book และชุดสื่อพิมพ์และดิจิทัลที่ธุรกิจใช้งานได้จริง — สอดคล้องกันในทุกจุดที่ลูกค้าเห็น"}'::jsonb,
     '{"en":"F2 designs brand systems end-to-end for hotels, villas, and tour operators. Logo + logotype, colour palette, typography, brand book / usage guidelines, business cards, letterheads, menu templates, signage, plus the digital asset kit (social templates, favicons, email signatures). Delivered as production-ready files — SVG, editable AI/PSD sources, and a PDF brand book that new suppliers can follow.","th":"F2 ออกแบบระบบแบรนด์ครบวงจรให้โรงแรม วิลล่า และผู้ประกอบการทัวร์ ตั้งแต่โลโก้และโลโก้ไทป์ พาเลตต์สี ไทโปกราฟี brand book / usage guideline นามบัตร หัวจดหมาย เทมเพลตเมนู ป้าย รวมถึง digital asset kit (เทมเพลตโซเชียล favicon ลายเซ็นอีเมล) ส่งมอบเป็นไฟล์พร้อมใช้งาน SVG ไฟล์ต้นฉบับ AI/PSD และ brand book แบบ PDF ที่ supplier ใหม่ทำตามได้ทันที"}'::jsonb,
     'Palette', 'marketing', 40, FALSE)
ON CONFLICT (slug) DO NOTHING;


-- ---------- 2. My Samui Island Tour full services array ----------
UPDATE customers
   SET services_used = ARRAY[
           'domain-hosting',
           'dns-management',
           'web-hosting',
           'business-email',
           'website-development',
           'it-management',
           'iacc-saas',
           'corporate-identity'
       ],
       notes = 'Full-stack IT + branding partner. F2 delivers corporate identity, website design + development, iACC SaaS booking platform, domain + DNS + web hosting, business email, and ongoing IT management.'
 WHERE slug = 'my-samui-island-tour';


-- ---------- 3. Case study draft (unpublished) ----------
INSERT INTO case_studies
    (slug, client_name, industry, location,
     summary, challenge, solution, results,
     services_used, sort_order, is_published)
VALUES
    ('my-samui-island-tour',
     'My Samui Island Tour Co.,Ltd.',
     'Travel & Tour Operator',
     'Koh Samui, Thailand',
     '{"en":"Full-stack IT and brand partner to a Koh Samui tour operator — from corporate identity and website to iACC-powered booking operations, business email, and day-to-day infrastructure management.","th":"พาร์ทเนอร์ไอทีและแบรนด์ครบวงจรของผู้ประกอบการทัวร์เกาะสมุย — ตั้งแต่อัตลักษณ์องค์กร เว็บไซต์ ไปจนถึงระบบจองบน iACC บริการอีเมลธุรกิจ และการดูแลโครงสร้างพื้นฐานประจำวัน"}'::jsonb,
     '{"en":"My Samui Island Tour needed to launch a modern tour-operator brand from scratch: a distinct visual identity, a bookings-capable website, reliable email on their own domain, and infrastructure they didn''t have to think about. Coordinating a designer, a web team, a hosting vendor, and an IT provider separately would have meant four contracts, four invoices, and inconsistent hand-offs at every boundary.","th":"My Samui Island Tour ต้องการเปิดตัวแบรนด์ผู้ประกอบการทัวร์ยุคใหม่จากศูนย์: อัตลักษณ์ทางภาพที่โดดเด่น เว็บไซต์ที่รองรับการจอง อีเมลบนโดเมนตัวเองที่เชื่อถือได้ และโครงสร้างพื้นฐานที่พวกเขาไม่ต้องคิดถึงเอง การประสานงานกับดีไซเนอร์ ทีมเว็บ vendor โฮสติ้ง และผู้ให้บริการไอทีแยกกันหมายถึงสี่สัญญา สี่ใบแจ้งหนี้ และการส่งต่องานที่ไม่สอดคล้องในทุกรอยต่อ"}'::jsonb,
     '{"en":"F2 delivered the full stack under a single accountable partnership. Corporate identity work first — logo, brand book, digital + print asset kit. Then the website: bilingual EN + TH, integrated with F2''s iACC SaaS for tour bookings and operations. Domain registration, DNS hosting, cPanel web hosting, and business email on their own domain — all consolidated under Thai Baht billing. Ongoing IT management keeps the whole environment healthy without them having to hire in-house.","th":"F2 ส่งมอบครบทั้งสแตกภายใต้พาร์ทเนอร์ชิพเดียวที่รับผิดชอบทุกส่วน เริ่มจากอัตลักษณ์องค์กร — โลโก้ brand book ชุดสื่อดิจิทัลและสิ่งพิมพ์ ต่อด้วยเว็บไซต์: สองภาษา EN + TH เชื่อมกับ iACC SaaS ของ F2 สำหรับการจองทัวร์และการดำเนินงาน จดโดเมน โฮสต์ DNS โฮสต์เว็บ cPanel และอีเมลธุรกิจบนโดเมนของพวกเขาเอง — รวมออกใบแจ้งหนี้เป็นเงินบาททั้งหมด การดูแลไอทีต่อเนื่องทำให้สภาพแวดล้อมทั้งหมดพร้อมใช้งาน โดยที่พวกเขาไม่ต้องจ้าง in-house"}'::jsonb,
     '{"en":"One vendor across brand, product, and infrastructure — one point of contact, one PO, one accountable team. Faster launch than a multi-vendor build, and every layer designed to grow with the business. The booking platform (iACC) already supports multi-currency and multi-language for the tourism season pipeline; the brand system scales cleanly to new tour products and merchandising.","th":"vendor เดียวครอบคลุมทั้งแบรนด์ ผลิตภัณฑ์ และโครงสร้างพื้นฐาน — จุดติดต่อเดียว PO เดียว ทีมที่รับผิดชอบเดียว เปิดตัวเร็วกว่าการใช้ vendor หลายราย และทุกชั้นถูกออกแบบให้ scale ตามธุรกิจ แพลตฟอร์มจองบน iACC รองรับหลายสกุลเงินและหลายภาษาสำหรับ pipeline ฤดูท่องเที่ยวอยู่แล้ว ระบบแบรนด์ scale ไปยังผลิตภัณฑ์ทัวร์และของที่ระลึกใหม่ได้อย่างสะอาด"}'::jsonb,
     ARRAY['corporate-identity','website-development','iacc-saas','domain-hosting','dns-management','web-hosting','business-email','it-management'],
     40,   -- after Miskawaan (30)
     FALSE -- unpublished; SEO + Copywriter agent to polish, then admin publishes from /admin/case-studies
    )
ON CONFLICT (slug) DO NOTHING;
