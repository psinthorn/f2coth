-- 055_seed_contract_templates.sql
-- Seeds TWO contract templates so the multi-template machinery is exercised
-- from day one:
--   1. service-agreement — F2's IT System Audit Service Agreement (the
--      production-proven skeleton, parameterised). doc_prefix F2-AGR.
--   2. mutual-nda        — a structurally different type (parties + term +
--      governing law, NO fee fields) that proves the docgen builder
--      registry generalises. doc_prefix F2-NDA.
--
-- Each row's `code` MUST match a builder registered in the docgen service
-- (lib/builders/index.js). merge_schema.fields drives the admin wizard form
-- and supplies docgen field defaults. Party legal details (legal_name_en/th,
-- tax_id, address, notice_email) come from contract_parties, NOT merge_data,
-- so they are not repeated here.
--
-- Idempotent: ON CONFLICT (code) refreshes name/version/prefix/schema so
-- re-running migrations keeps the seed current.
--
-- Next migration: 056_*.sql

BEGIN;

-- ─────────────────────────────────────────────
-- 1. service-agreement
-- ─────────────────────────────────────────────
INSERT INTO contract_templates (code, name, version, doc_prefix, merge_schema, is_active) VALUES (
  'service-agreement',
  'IT System Audit Service Agreement',
  '1.0',
  'F2-AGR',
  '{
    "fields": [
      {"key":"effective_date","type":"date","label_en":"Effective date","label_th":"วันที่เริ่มสัญญา","required":true,"group":"term"},
      {"key":"term_months","type":"int","label_en":"Term (months)","label_th":"ระยะเวลา (เดือน)","required":true,"default":3,"group":"term"},
      {"key":"fee_monthly","type":"money","label_en":"Monthly fee (THB)","label_th":"ค่าบริการรายเดือน (บาท)","required":true,"default":15000,"group":"fees"},
      {"key":"fee_total","type":"money","label_en":"Total fee (THB)","label_th":"ค่าบริการรวม (บาท)","required":true,"default":45000,"group":"fees"},
      {"key":"fee_total_words_en","type":"text","label_en":"Total in words (EN)","label_th":"จำนวนเงินเป็นตัวอักษร (อังกฤษ)","required":false,"default":"forty-five thousand baht","group":"fees"},
      {"key":"fee_total_words_th","type":"text","label_en":"Total in words (TH)","label_th":"จำนวนเงินเป็นตัวอักษร (ไทย)","required":false,"default":"สี่หมื่นห้าพันบาทถ้วน","group":"fees"},
      {"key":"payment_terms","type":"enum","options":["advance","monthly"],"label_en":"Payment terms","label_th":"เงื่อนไขการชำระเงิน","required":true,"default":"advance","group":"fees"},
      {"key":"callout_fee","type":"money","label_en":"Emergency call-out fee (THB)","label_th":"ค่าเรียกเข้าฉุกเฉิน (บาท)","required":false,"default":1500,"group":"fees"},
      {"key":"service_area","type":"text","label_en":"Service area","label_th":"พื้นที่ให้บริการ","required":true,"default":"Koh Samui","group":"scope"},
      {"key":"audit_schedule","type":"array","label_en":"Audit schedule (month → scope)","label_th":"แผนการตรวจสอบ (เดือน → ขอบเขต)","required":false,"item_fields":["month","scope_en","scope_th"],"default":[
        {"month":1,"scope_en":"Kickoff (contacts, credentials, asset register) + Network & Internet + Wi-Fi audit","scope_th":"เริ่มโครงการ (ผู้ติดต่อ รหัสผ่าน ทะเบียนทรัพย์สิน) + ตรวจสอบเครือข่ายและอินเทอร์เน็ต + Wi-Fi"},
        {"month":2,"scope_en":"Server/NAS & shared data + Backup & disaster recovery + Computers/printers + Email & Microsoft 365","scope_th":"เซิร์ฟเวอร์/NAS และข้อมูลส่วนกลาง + ระบบสำรองข้อมูลและกู้คืน + คอมพิวเตอร์/เครื่องพิมพ์ + อีเมลและ Microsoft 365"},
        {"month":3,"scope_en":"Security & user accounts + CCTV system audit (final phase) + final audit report compiled and presented to management","scope_th":"ความปลอดภัยและบัญชีผู้ใช้ + ตรวจสอบระบบกล้องวงจรปิด (CCTV) เป็นลำดับสุดท้าย + จัดทำและนำเสนอรายงานผลการตรวจสอบฉบับสมบูรณ์ต่อผู้บริหาร"}
      ],"group":"scope"},
      {"key":"watermark_text","type":"text","label_en":"Draft watermark text","label_th":"ข้อความลายน้ำฉบับร่าง","required":false,"default":"F2 SLA Draft","group":"meta"}
    ]
  }'::jsonb,
  TRUE
)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      version = EXCLUDED.version,
      doc_prefix = EXCLUDED.doc_prefix,
      merge_schema = EXCLUDED.merge_schema;

-- ─────────────────────────────────────────────
-- 2. mutual-nda
-- ─────────────────────────────────────────────
INSERT INTO contract_templates (code, name, version, doc_prefix, merge_schema, is_active) VALUES (
  'mutual-nda',
  'Mutual Non-Disclosure Agreement',
  '1.0',
  'F2-NDA',
  '{
    "fields": [
      {"key":"effective_date","type":"date","label_en":"Effective date","label_th":"วันที่เริ่มสัญญา","required":true,"group":"term"},
      {"key":"term_months","type":"int","label_en":"Term (months)","label_th":"ระยะเวลา (เดือน)","required":true,"default":12,"group":"term"},
      {"key":"survival_years","type":"int","label_en":"Confidentiality survival (years)","label_th":"ระยะเวลาคุ้มครองหลังสิ้นสุด (ปี)","required":true,"default":2,"group":"term"},
      {"key":"purpose_en","type":"text","label_en":"Purpose of disclosure (EN)","label_th":"วัตถุประสงค์ของการเปิดเผย (อังกฤษ)","required":true,"default":"evaluating a potential IT services engagement","group":"scope"},
      {"key":"purpose_th","type":"text","label_en":"Purpose of disclosure (TH)","label_th":"วัตถุประสงค์ของการเปิดเผย (ไทย)","required":true,"default":"เพื่อประเมินความเป็นไปได้ในการว่าจ้างงานบริการไอที","group":"scope"},
      {"key":"service_area","type":"text","label_en":"Governing jurisdiction","label_th":"เขตอำนาจศาล","required":true,"default":"Koh Samui","group":"scope"},
      {"key":"watermark_text","type":"text","label_en":"Draft watermark text","label_th":"ข้อความลายน้ำฉบับร่าง","required":false,"default":"F2 NDA Draft","group":"meta"}
    ]
  }'::jsonb,
  TRUE
)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      version = EXCLUDED.version,
      doc_prefix = EXCLUDED.doc_prefix,
      merge_schema = EXCLUDED.merge_schema;

COMMIT;
