-- 043_service_intro_and_faq.sql
-- SEO/AEO uplift on service detail pages.
--
--   1. Add `intro` JSONB (en/th) — a 40–55 word direct-answer paragraph
--      that renders immediately below H1. Google AI Overviews / ChatGPT
--      / Perplexity pull this as the citable summary sentence.
--   2. Add `faq` JSONB (en/th, each an array of {q, a}) — powers a
--      per-service FAQ block plus schema.org FAQPage markup.
--
-- Seeds intro + FAQ content for all 10 published services. Content is
-- factual + citation-friendly per the GEO discipline in docs/seo-specs.md.
-- Admins can override any field later via the existing service editor
-- (schema.tsx additions to be shipped alongside).
--
-- Next migration: 044_*.sql

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS intro JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS faq   JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ─────────────────────────────────────────────
-- Seed intro + faq for each service
-- ─────────────────────────────────────────────

UPDATE services SET
    intro = jsonb_build_object(
        'en', 'IT management is the day-to-day operation and monitoring of your servers, networks, workstations, and cloud services. F2 handles it for luxury hospitality properties across Thailand — from Bangkok resorts to island villas — so your team focuses on guests, not tickets.',
        'th', 'บริการดูแลระบบไอทีคือการดำเนินงานและติดตามเซิร์ฟเวอร์ เครือข่าย เครื่องผู้ใช้ และบริการคลาวด์ในแต่ละวัน F2 ดูแลให้แก่โรงแรมและวิลล่าระดับลักซ์ชัวรีทั่วประเทศไทย เพื่อให้ทีมงานของคุณโฟกัสที่แขก ไม่ใช่ตั๋วซัพพอร์ต'
    ),
    faq = jsonb_build_object(
        'en', jsonb_build_array(
            jsonb_build_object('q', 'What does F2 IT management include?',
                'a', 'Monitoring, patching, help-desk, backup verification, security updates, vendor coordination, and a monthly report. See our SLA options for response-time tiers.'),
            jsonb_build_object('q', 'Which hospitality systems do you support?',
                'a', 'Property management systems (Opera, Cloudbeds, Mews), POS, Wi-Fi guest networks, IP telephony, CCTV, door-lock integration, and back-office Microsoft 365.'),
            jsonb_build_object('q', 'How fast is on-site response?',
                'a', 'From 2 hours in Koh Samui and Bangkok, 4 hours in Phuket and Hua Hin, and next-day in other regions. Emergency escalation is 24/7.')
        ),
        'th', jsonb_build_array(
            jsonb_build_object('q', 'บริการดูแลระบบไอทีของ F2 ครอบคลุมอะไรบ้าง?',
                'a', 'ติดตามระบบ อัปเดตแพตช์ ช่วยเหลือผู้ใช้ ตรวจสอบสำรองข้อมูล อัปเดตความปลอดภัย ประสานงานผู้จำหน่าย และรายงานประจำเดือน ดูตัวเลือก SLA สำหรับระดับเวลาตอบสนอง'),
            jsonb_build_object('q', 'ระบบโรงแรมอะไรบ้างที่รองรับ?',
                'a', 'ระบบจัดการห้องพัก (Opera, Cloudbeds, Mews), POS, Wi-Fi สำหรับแขก, โทรศัพท์ IP, กล้องวงจรปิด, ระบบล็อคประตู และ Microsoft 365 สำหรับสำนักงาน'),
            jsonb_build_object('q', 'เวลาตอบสนองที่หน้างานเร็วแค่ไหน?',
                'a', '2 ชั่วโมงในเกาะสมุยและกรุงเทพฯ 4 ชั่วโมงในภูเก็ตและหัวหิน และภายในวันถัดไปในภูมิภาคอื่น มีการยกระดับเหตุฉุกเฉินตลอด 24 ชั่วโมง')
        )
    )
WHERE slug = 'it-management';

UPDATE services SET
    intro = jsonb_build_object(
        'en', 'Cybersecurity for hospitality means protecting guest data, payment systems, and property networks from ransomware, phishing, and Wi-Fi intrusion. F2 implements PDPA-aligned defence — endpoint protection, MFA, backup, and 24/7 monitoring — sized for boutique to 200-room properties.',
        'th', 'ความปลอดภัยไซเบอร์สำหรับธุรกิจโรงแรม คือการปกป้องข้อมูลแขก ระบบชำระเงิน และเครือข่ายทรัพย์สินจากแรนซัมแวร์ ฟิชชิ่ง และการบุกรุกผ่าน Wi-Fi F2 ใช้มาตรการที่สอดคล้องกับ PDPA — Endpoint protection, MFA, สำรองข้อมูล และการติดตาม 24/7 — ปรับให้เข้ากับตั้งแต่บูติกโฮเทลถึงโรงแรม 200 ห้อง'
    ),
    faq = jsonb_build_object(
        'en', jsonb_build_array(
            jsonb_build_object('q', 'What''s the minimum baseline for a small hotel?',
                'a', 'MFA on every admin account, endpoint EDR on every device, offline backup, network segmentation between staff/guest/IoT, and monthly patch review. F2 can deploy this in 2–3 weeks.'),
            jsonb_build_object('q', 'How does F2 handle PDPA compliance?',
                'a', 'We map data flows, assist with your Data Protection Officer appointment, review consent forms, and run a yearly PDPA audit. Documentation is included in the SLA package.'),
            jsonb_build_object('q', 'What happens if we get hit by ransomware?',
                'a', 'F2 declares an incident, isolates affected systems, restores from offline backup, notifies the PDPC per PDPA timelines, and produces a post-incident report within 14 days.')
        ),
        'th', jsonb_build_array(
            jsonb_build_object('q', 'มาตรฐานขั้นต่ำสำหรับโรงแรมขนาดเล็กคืออะไร?',
                'a', 'MFA ทุกบัญชีผู้ดูแล, EDR ทุกเครื่อง, สำรองข้อมูลออฟไลน์, แบ่งเครือข่ายพนักงาน/แขก/IoT, และตรวจสอบแพตช์รายเดือน F2 ติดตั้งได้ใน 2–3 สัปดาห์'),
            jsonb_build_object('q', 'F2 จัดการ PDPA อย่างไร?',
                'a', 'เราจัดทำแผนที่การไหลของข้อมูล ช่วยแต่งตั้ง DPO ทบทวนแบบฟอร์มความยินยอม และทำการตรวจสอบ PDPA รายปี เอกสารทั้งหมดรวมอยู่ในแพ็คเกจ SLA'),
            jsonb_build_object('q', 'ถ้าถูกโจมตีด้วยแรนซัมแวร์จะทำอย่างไร?',
                'a', 'F2 ประกาศเหตุการณ์ แยกระบบที่ได้รับผลกระทบ กู้คืนจากสำรองออฟไลน์ แจ้ง สคส. ตามกำหนดเวลา PDPA และจัดทำรายงานหลังเหตุการณ์ภายใน 14 วัน')
        )
    )
WHERE slug = 'cybersecurity';

UPDATE services SET
    intro = jsonb_build_object(
        'en', 'Cloud infrastructure means running your PMS, files, and business apps on managed servers in Thailand instead of ageing on-premise boxes. F2 designs, migrates, and operates AWS, Azure, and on-shore Thai cloud footprints — with data residency and cost control built in.',
        'th', 'โครงสร้างพื้นฐานคลาวด์คือการรันระบบ PMS ไฟล์ และแอปธุรกิจของคุณบนเซิร์ฟเวอร์ที่ดูแลอยู่ในไทย แทนเซิร์ฟเวอร์เก่าในสำนักงาน F2 ออกแบบ ย้าย และดำเนินการ AWS, Azure และคลาวด์ในประเทศไทย พร้อมควบคุมค่าใช้จ่ายและที่ตั้งข้อมูล'
    ),
    faq = jsonb_build_object(
        'en', jsonb_build_array(
            jsonb_build_object('q', 'Should our data stay in Thailand?',
                'a', 'For hospitality, yes — guest and payment data under PDPA benefits from local residency. F2 uses Thai-region AWS, Azure, and CAT/NT tier-3 data centres.'),
            jsonb_build_object('q', 'How long does a cloud migration take?',
                'a', 'Typical PMS/back-office migration is 6–10 weeks including discovery, pilot, cutover, and 30-day hypercare. F2 runs migration in stages so operations never pause.'),
            jsonb_build_object('q', 'Will cloud cost more than on-premise?',
                'a', 'Sticker prices are higher, but F2 sizes for peak occupancy and shuts down non-prod overnight — many properties see 30–40% lower total cost of ownership over three years.')
        ),
        'th', jsonb_build_array(
            jsonb_build_object('q', 'ข้อมูลควรอยู่ในไทยหรือไม่?',
                'a', 'สำหรับธุรกิจโรงแรมควรอยู่ในไทย ข้อมูลแขกและการชำระเงินภายใต้ PDPA ได้ประโยชน์จากการอยู่ในประเทศ F2 ใช้ AWS/Azure ที่มี Region ไทย และดาต้าเซ็นเตอร์ระดับ tier-3 ของ CAT/NT'),
            jsonb_build_object('q', 'ย้ายขึ้นคลาวด์ใช้เวลาเท่าใด?',
                'a', 'โดยทั่วไป PMS/สำนักงานย้ายใน 6–10 สัปดาห์ รวมสำรวจ ทดลอง ย้ายจริง และดูแลใกล้ชิด 30 วัน F2 ทำเป็นขั้นเพื่อไม่ให้กระทบการดำเนินงาน'),
            jsonb_build_object('q', 'คลาวด์จะแพงกว่าเซิร์ฟเวอร์ในสำนักงานไหม?',
                'a', 'ป้ายราคาสูงกว่า แต่ F2 คำนวณตามช่วง peak และปิดระบบที่ไม่ใช่ prod ตอนกลางคืน หลายโรงแรมประหยัด TCO ได้ 30–40% ในสามปี')
        )
    )
WHERE slug = 'cloud-infrastructure';

UPDATE services SET
    intro = jsonb_build_object(
        'en', 'AI-driven solutions for hotels use large-language-model chatbots, image analytics, and predictive maintenance to reduce staff load and lift guest satisfaction. F2 integrates Claude, GPT, and open-source models into your PMS and CRM workflows.',
        'th', 'โซลูชัน AI สำหรับโรงแรมใช้แชทบอท LLM การวิเคราะห์ภาพ และการบำรุงรักษาเชิงคาดการณ์เพื่อลดภาระพนักงานและเพิ่มความพึงพอใจของแขก F2 ผสาน Claude, GPT และโมเดลโอเพนซอร์สเข้ากับ PMS และ CRM ของคุณ'
    ),
    faq = jsonb_build_object(
        'en', jsonb_build_array(
            jsonb_build_object('q', 'What''s the fastest AI win for a hotel?',
                'a', 'A bilingual guest-service chatbot on WhatsApp + web chat that handles routing, FAQs, and pre-arrival forms. Deploys in 2–3 weeks and reduces front-desk load by 20–30%.'),
            jsonb_build_object('q', 'Does F2 host the AI models on-premise?',
                'a', 'Depending on data sensitivity: open-source models (Llama, Mistral) can run on Thai cloud; frontier models (Claude, GPT) call out to hosted APIs with PDPA-compliant data handling.'),
            jsonb_build_object('q', 'How is guest data protected in AI workflows?',
                'a', 'PII is redacted before it leaves the property, prompt/response logs are retained per PDPA, and F2 signs the DPA required by the AI provider.')
        ),
        'th', jsonb_build_array(
            jsonb_build_object('q', 'AI ที่คุ้มค่าเร็วที่สุดสำหรับโรงแรมคืออะไร?',
                'a', 'แชทบอทบริการแขกสองภาษาผ่าน WhatsApp และเว็บแชท ที่จัดการการส่งต่อ FAQ และแบบฟอร์มก่อนเข้าพัก ติดตั้งใน 2–3 สัปดาห์ ลดภาระ front-desk 20–30%'),
            jsonb_build_object('q', 'F2 โฮสต์โมเดล AI เองไหม?',
                'a', 'ขึ้นกับความไวของข้อมูล โมเดลโอเพนซอร์ส (Llama, Mistral) รันบนคลาวด์ไทยได้ ส่วนโมเดลระดับสูง (Claude, GPT) เรียก API พร้อมการจัดการข้อมูลตาม PDPA'),
            jsonb_build_object('q', 'ปกป้องข้อมูลแขกใน AI workflow อย่างไร?',
                'a', 'ข้อมูลส่วนบุคคลถูก redact ก่อนออกจากทรัพย์สิน บันทึก prompt/response เก็บตาม PDPA และ F2 ลงนาม DPA ที่ผู้ให้บริการ AI กำหนด')
        )
    )
WHERE slug = 'ai-driven-solutions';

UPDATE services SET
    intro = jsonb_build_object(
        'en', 'iACC is F2''s cloud accounting SaaS built for Thai hospitality businesses. It handles invoicing, tax invoices, VAT, withholding tax, and multi-currency — with Thai and English UI, and integrates with hotel PMS + payment gateways.',
        'th', 'iACC คือระบบบัญชีคลาวด์ SaaS ของ F2 สำหรับธุรกิจโรงแรมไทย ครอบคลุมการออกใบแจ้งหนี้ ใบกำกับภาษี VAT ภาษีหัก ณ ที่จ่าย และหลายสกุลเงิน มี UI ไทยและอังกฤษ และเชื่อมกับ PMS โรงแรมและ Payment Gateway'
    ),
    faq = jsonb_build_object(
        'en', jsonb_build_array(
            jsonb_build_object('q', 'Is iACC certified for Thai tax filing?',
                'a', 'Yes — iACC generates Revenue Department-compliant tax invoices, VAT (Por.Por.30), withholding tax (Por.Ngor.Dor.3/53), and can produce the required XML for e-Tax Invoice submission.'),
            jsonb_build_object('q', 'Which PMS and payment gateways integrate?',
                'a', 'Opera Cloud, Cloudbeds, Mews via API; Kasikorn, SCB, Bangkok Bank, and Omise for payments; PromptPay QR + PayPal for guest self-service.'),
            jsonb_build_object('q', 'How does pricing work?',
                'a', 'Per-property monthly subscription based on user count and transaction volume. Setup + data migration included in year-one fee. See the iACC page for tier details.')
        ),
        'th', jsonb_build_array(
            jsonb_build_object('q', 'iACC รับรองสำหรับการยื่นภาษีไทยหรือไม่?',
                'a', 'ใช่ — iACC สร้างใบกำกับภาษีที่สอดคล้องกับกรมสรรพากร VAT (ภ.พ.30), ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.3/53) และสร้าง XML สำหรับส่ง e-Tax Invoice ได้'),
            jsonb_build_object('q', 'เชื่อมต่อกับ PMS และ Payment Gateway อะไรบ้าง?',
                'a', 'Opera Cloud, Cloudbeds, Mews ผ่าน API; กสิกร SCB กรุงเทพ และ Omise สำหรับชำระเงิน; PromptPay QR + PayPal สำหรับ self-service ของแขก'),
            jsonb_build_object('q', 'ราคาคิดอย่างไร?',
                'a', 'สมาชิกรายเดือนต่อทรัพย์สิน ตามจำนวนผู้ใช้และปริมาณธุรกรรม การติดตั้งและย้ายข้อมูลรวมในค่าธรรมเนียมปีแรก ดูรายละเอียดในหน้า iACC')
        )
    )
WHERE slug = 'iacc-saas';

-- Remaining 5 services get intro only (FAQ empty — admin can fill via editor).
UPDATE services SET
    intro = jsonb_build_object(
        'en', 'Digital transformation for hospitality is the phased replacement of paper and legacy systems with cloud-native workflows — PMS on cloud, guest apps, staff mobile tools, and AI assistants. F2 sequences the work so operations never pause.',
        'th', 'การทรานส์ฟอร์เมชันดิจิทัลสำหรับโรงแรมคือการทยอยแทนที่ระบบกระดาษและระบบเก่าด้วยเวิร์กโฟลว์คลาวด์ — PMS คลาวด์ แอปแขก เครื่องมือมือถือของพนักงาน และผู้ช่วย AI F2 จัดลำดับงานให้ระบบไม่หยุดชะงัก'
    )
WHERE slug = 'digital-transformation';

UPDATE services SET
    intro = jsonb_build_object(
        'en', 'DevOps and CI/CD gives your engineering team automated build, test, and deploy pipelines so releases are boring instead of tense. F2 wires up GitHub Actions, GitLab CI, or Bitbucket Pipelines against your cloud and staging environments.',
        'th', 'DevOps และ CI/CD ให้ทีมวิศวกรของคุณมี pipeline สร้าง ทดสอบ และ deploy อัตโนมัติ เพื่อการ release ที่ราบรื่นไม่ตึงเครียด F2 ตั้งค่า GitHub Actions, GitLab CI หรือ Bitbucket Pipelines ให้ทำงานกับคลาวด์และสภาพแวดล้อม staging ของคุณ'
    )
WHERE slug = 'devops-cicd';

UPDATE services SET
    intro = jsonb_build_object(
        'en', 'Domain registration and web hosting from F2 covers .co.th, .th, .com, and 200+ TLDs, plus Thai-region cPanel hosting on tier-3 data centres. Included: DNS management, SSL, daily backup, and 99.9% uptime SLA.',
        'th', 'บริการจดโดเมนและ Web Hosting ของ F2 ครอบคลุม .co.th, .th, .com และ TLD กว่า 200 พร้อม cPanel Hosting ในไทยระดับ tier-3 รวม DNS, SSL, สำรองข้อมูลรายวัน และ SLA อัปไทม์ 99.9%'
    )
WHERE slug = 'domain-hosting';

UPDATE services SET
    intro = jsonb_build_object(
        'en', 'Managed IT support (MSP) means a Thai-fluent help-desk, on-site engineers, and monthly reporting for a flat monthly fee — no surprise time-and-materials bills. F2 covers Bangkok, Koh Samui, Phuket, Hua Hin, and Krabi with same-day response.',
        'th', 'บริการ IT Support แบบ MSP หมายถึงทีม help-desk พูดไทยได้ วิศวกรลงหน้างาน และรายงานประจำเดือน ในค่าธรรมเนียมรายเดือนคงที่ ไม่มีบิลตามชั่วโมงที่คาดไม่ถึง F2 ครอบคลุมกรุงเทพ เกาะสมุย ภูเก็ต หัวหิน และกระบี่ พร้อมตอบสนองภายในวันเดียว'
    )
WHERE slug = 'it-support-msp';

UPDATE services SET
    intro = jsonb_build_object(
        'en', 'Hardware and solar solutions from F2 cover the physical layer — servers, network gear, CCTV, Starlink for remote islands, and rooftop solar with battery backup. We spec, install, warranty, and monitor everything against Thai grid volatility.',
        'th', 'โซลูชันฮาร์ดแวร์และโซลาร์ของ F2 ครอบคลุมชั้นทางกายภาพ — เซิร์ฟเวอร์ อุปกรณ์เครือข่าย CCTV, Starlink สำหรับเกาะห่างไกล และโซลาร์เซลล์บนหลังคาพร้อมแบตเตอรี่สำรอง เราจัดสเปค ติดตั้ง รับประกัน และติดตามการทำงานเทียบกับความผันผวนของไฟฟ้าไทย'
    )
WHERE slug = 'hardware-solar';
