-- 041_seed_miskawaan_project.sql
-- Two seeds bundled — both idempotent.
--
--   1. First real project (Miskawaan Beachfront Villas) attached to all
--      12 seed templates, so the checklist-api has real data end-to-end.
--   2. project_weekly_summary notification template — powers the Friday
--      email from checklist-api to the customer's primary contact.
--
-- Next migration: 042_*.sql

-- ─────────────────────────────────────────────
-- Weekly summary notification template
-- ─────────────────────────────────────────────
INSERT INTO notification_templates (code, description, subject_tmpl, body_tmpl, is_active)
VALUES (
    'project_weekly_summary',
    'Weekly checklist summary sent to a customer''s primary contact',
    jsonb_build_object(
        'en', '[F2] Weekly update — {{project_name}}',
        'th', '[F2] อัปเดตประจำสัปดาห์ — {{project_name}}'
    ),
    jsonb_build_object(
        'en',
'Hi {{contact_name}},

Here is this week''s update on {{project_name}}:

Progress: {{done}} of {{total}} items completed
Passed: {{pass}} · Failed: {{fail}} · N/A: {{na}} · Pending: {{pending}}

{{summary_line}}

View the full report:
{{report_url}}

— F2 Co., Ltd.',
        'th',
'สวัสดี {{contact_name}}

รายงานประจำสัปดาห์สำหรับ {{project_name}}:

ความคืบหน้า: {{done}} จาก {{total}} รายการ
ผ่าน: {{pass}} · ไม่ผ่าน: {{fail}} · ไม่เกี่ยวข้อง: {{na}} · รอตรวจ: {{pending}}

{{summary_line}}

ดูรายงานเต็ม:
{{report_url}}

— F2 Co., Ltd.'
    ),
    TRUE
)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- Project (idempotent by (customer_id, name))
-- ─────────────────────────────────────────────
INSERT INTO projects (client_name, name, status, customer_id, visible_to_customer)
SELECT
    'Miskawaan Beachfront Villas',
    'Miskawaan IT — Audit & Weekly Maintenance',
    'active',
    c.id,
    TRUE
FROM customers c
WHERE c.slug = 'miskawaan-villas'
  AND NOT EXISTS (
    SELECT 1 FROM projects p
     WHERE p.customer_id = c.id
       AND p.name = 'Miskawaan IT — Audit & Weekly Maintenance'
  );

-- ─────────────────────────────────────────────
-- Attach all 12 templates (A–L) as project_modules
-- Positioned in template.sort_order.
-- ─────────────────────────────────────────────
INSERT INTO project_modules (project_id, template_id, position)
SELECT p.id, t.id, t.sort_order - 1
  FROM projects p
  JOIN checklist_templates t ON t.is_active = TRUE
 WHERE p.name = 'Miskawaan IT — Audit & Weekly Maintenance'
   AND p.customer_id = (SELECT id FROM customers WHERE slug = 'miskawaan-villas')
ON CONFLICT (project_id, template_id) DO NOTHING;

-- ─────────────────────────────────────────────
-- Snapshot template items into project_items for each newly-attached
-- module. WHERE-NOT-EXISTS makes this idempotent — re-running won't
-- duplicate items.
-- ─────────────────────────────────────────────
INSERT INTO project_items (project_module_id, text_en, text_th, sort_order, required)
SELECT pm.id, ti.text_en, ti.text_th, ti.sort_order, ti.required
  FROM project_modules pm
  JOIN projects p ON p.id = pm.project_id
  JOIN checklist_template_items ti ON ti.template_id = pm.template_id
 WHERE p.name = 'Miskawaan IT — Audit & Weekly Maintenance'
   AND p.customer_id = (SELECT id FROM customers WHERE slug = 'miskawaan-villas')
   AND NOT EXISTS (
     SELECT 1 FROM project_items pi
      WHERE pi.project_module_id = pm.id
        AND pi.sort_order = ti.sort_order
   );
