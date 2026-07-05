-- 039_checklist_seed.sql
-- Seed the checklist template library (12 modules, 78 bilingual items)
-- and the module-toggle registry entries for the new admin section.
--
-- Idempotent: ON CONFLICT DO NOTHING on template code + module key.
--
-- Next migration: 040_*.sql

-- ─────────────────────────────────────────────
-- Module-toggle rows for the new admin surface
-- (see 019_modules_and_audit_log.sql for the modules table)
-- ─────────────────────────────────────────────
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
    ('admin.projects',   'admin', 'Projects & Checklists', 'โปรเจกต์และเช็คลิสต์', 'Client IT project boards and checklists', true, false, 120),
    ('api.checklists',   'api',   'Checklist API',         'API เช็คลิสต์',        'Templates, projects, items, reports',      true, false, 100)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────
-- Templates (12) — one row per module in the audit checklist library.
-- ─────────────────────────────────────────────
INSERT INTO checklist_templates (code, name_en, name_th, icon, sort_order, is_active) VALUES
    ('A', 'Project Kickoff',              'เริ่มโครงการ',                        'rocket',       1,  true),
    ('B', 'Network & Internet Audit',     'ตรวจสอบเครือข่ายและอินเทอร์เน็ต',      'network',      2,  true),
    ('C', 'Wi-Fi Audit',                  'ตรวจสอบ Wi-Fi',                       'wifi',         3,  true),
    ('D', 'CCTV Audit',                   'ตรวจสอบกล้องวงจรปิด',                 'camera',       4,  true),
    ('E', 'Server / NAS & Shared Data',   'เซิร์ฟเวอร์และข้อมูลส่วนกลาง',          'server',       5,  true),
    ('F', 'Backup & Disaster Recovery',   'สำรองข้อมูลและกู้คืน',                 'archive',      6,  true),
    ('G', 'Computers, Printers & Endpoints', 'คอมพิวเตอร์และอุปกรณ์ผู้ใช้',       'monitor',      7,  true),
    ('H', 'Email & Microsoft 365',        'อีเมลและ Microsoft 365',              'mail',         8,  true),
    ('I', 'Security & Accounts',          'ความปลอดภัยและบัญชีผู้ใช้',            'shield',       9,  true),
    ('J', 'Weekly Visit Routine',         'งานประจำรายสัปดาห์',                   'calendar',    10,  true),
    ('K', 'Monthly Reporting',            'รายงานประจำเดือน',                    'file-text',   11,  true),
    ('L', 'Audit Close-out & Handover',   'ปิดงานตรวจสอบและส่งมอบ',              'check-circle',12,  true)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- Template items (78) — grouped by template code.
-- ─────────────────────────────────────────────
INSERT INTO checklist_template_items (template_id, text_en, text_th, sort_order, required)
SELECT t.id, x.text_en, x.text_th, x.sort_order, x.required FROM checklist_templates t
JOIN (VALUES
    -- A: Project Kickoff
    ('A', 'Service agreement signed by both parties',                                        'ลงนามสัญญาบริการทั้งสองฝ่าย',                                                 1, true),
    ('A', 'Key contacts recorded (manager, staff, vendor, ISP)',                              'บันทึกผู้ติดต่อหลัก (ผู้จัดการ พนักงาน ผู้ขาย ISP)',                                  2, true),
    ('A', 'All admin credentials collected into secure password record',                     'รวบรวมรหัสผ่านผู้ดูแลระบบทั้งหมดไว้ในที่จัดเก็บที่ปลอดภัย',                            3, true),
    ('A', 'Asset register created (hardware + software + licenses)',                          'จัดทำทะเบียนทรัพย์สิน (ฮาร์ดแวร์ ซอฟต์แวร์ ไลเซนส์)',                              4, true),
    ('A', 'Floor plan / property map obtained for network & CCTV mapping',                    'ขอแบบแปลนอาคารเพื่อทำแผนที่เครือข่ายและกล้อง',                                    5, true),
    ('A', 'Weekly visit day/time agreed',                                                     'ตกลงวันและเวลาเข้าปฏิบัติงานรายสัปดาห์',                                          6, true),
    -- B: Network & Internet Audit
    ('B', 'Network diagram drawn (ISP → router → switches → APs)',                            'เขียนแผนผังเครือข่าย (ISP → เราเตอร์ → สวิตช์ → AP)',                            1, true),
    ('B', 'ISP lines documented: provider, speed, contract, cost',                            'บันทึกข้อมูลอินเทอร์เน็ต: ผู้ให้บริการ ความเร็ว สัญญา ค่าบริการ',                         2, true),
    ('B', 'Speed test at router and key locations',                                           'ทดสอบความเร็วที่เราเตอร์และจุดสำคัญ',                                            3, true),
    ('B', 'Router/firewall config reviewed, default passwords changed',                       'ตรวจการตั้งค่าเราเตอร์/ไฟร์วอลล์ เปลี่ยนรหัสผ่านเริ่มต้น',                              4, true),
    ('B', 'Switch locations, port usage, cable condition checked',                            'ตรวจตำแหน่งสวิตช์ การใช้งานพอร์ต และสภาพสายสัญญาณ',                             5, true),
    ('B', 'Failover/backup internet line assessed',                                           'ประเมินอินเทอร์เน็ตสำรอง',                                                       6, true),
    ('B', 'Guest network separated from staff/office network',                                'แยกเครือข่ายแขกออกจากเครือข่ายพนักงาน',                                        7, true),
    ('B', 'UPS protection for core network equipment',                                        'ตรวจ UPS สำหรับอุปกรณ์เครือข่ายหลัก',                                          8, true),
    -- C: Wi-Fi Audit
    ('C', 'Access point locations mapped',                                                    'จัดทำแผนที่ตำแหน่ง Access Point ทั้งหมด',                                        1, true),
    ('C', 'Signal walk-through: dead zones recorded per area/villa',                          'เดินตรวจสัญญาณและบันทึกจุดอับ',                                                 2, true),
    ('C', 'SSID structure reviewed (guest vs staff vs IoT)',                                  'ตรวจโครงสร้าง SSID (แขก / พนักงาน / IoT)',                                     3, true),
    ('C', 'Wi-Fi passwords policy and rotation checked',                                      'ตรวจนโยบายรหัสผ่าน Wi-Fi และรอบการเปลี่ยน',                                      4, true),
    ('C', 'AP firmware versions checked',                                                     'ตรวจเวอร์ชัน firmware ของ AP',                                                 5, true),
    ('C', 'Channel/interference issues assessed',                                             'ประเมินปัญหาช่องสัญญาณและการรบกวน',                                            6, true),
    -- D: CCTV Audit
    ('D', 'Camera inventory: location, model, working status',                                'ทะเบียนกล้อง: ตำแหน่ง รุ่น สถานะ',                                                1, true),
    ('D', 'Coverage gaps identified on property map',                                         'ระบุจุดที่กล้องยังไม่ครอบคลุมบนแผนที่',                                            2, true),
    ('D', 'Recording retention days verified (target ≥ 30 days)',                             'ตรวจจำนวนวันย้อนหลังที่บันทึก (เป้า ≥ 30 วัน)',                                    3, true),
    ('D', 'NVR/DVR health: disk status, time sync',                                           'ตรวจสุขภาพ NVR/DVR: ฮาร์ดดิสก์ เวลาซิงก์',                                        4, true),
    ('D', 'Remote viewing access works and is secured',                                       'ทดสอบการดูภาพระยะไกลและความปลอดภัย',                                          5, true),
    ('D', 'Default passwords changed on NVR and cameras',                                     'เปลี่ยนรหัสผ่านเริ่มต้นของ NVR และกล้อง',                                          6, true),
    ('D', 'Night vision / image quality spot-check',                                          'สุ่มตรวจคุณภาพภาพและภาพกลางคืน',                                                7, true),
    ('D', 'Power protection for NVR (UPS)',                                                   'ตรวจ UPS สำรองไฟของ NVR',                                                    8, true),
    -- E: Server / NAS & Shared Data
    ('E', 'Server/NAS inventory: model, age, warranty, role',                                 'ทะเบียนเซิร์ฟเวอร์: รุ่น อายุ ประกัน หน้าที่',                                        1, true),
    ('E', 'Disk health (SMART) and RAID status checked',                                      'ตรวจสุขภาพดิสก์ (SMART) และสถานะ RAID',                                        2, true),
    ('E', 'Storage capacity and growth reviewed',                                             'ตรวจพื้นที่จัดเก็บและแนวโน้มการเติบโต',                                             3, true),
    ('E', 'Shared folder structure and permissions reviewed',                                 'ตรวจโครงสร้างโฟลเดอร์และสิทธิ์เข้าถึง',                                             4, true),
    ('E', 'Firmware/OS updates status',                                                       'ตรวจสถานะการอัปเดต firmware/OS',                                              5, true),
    ('E', 'Physical location: ventilation, dust, power',                                      'ตรวจสถานที่ติดตั้ง: การระบายอากาศ ฝุ่น ไฟฟ้า',                                    6, true),
    -- F: Backup & Disaster Recovery
    ('F', 'What is backed up, where, how often — documented',                                 'บันทึกว่าอะไรถูกสำรอง เก็บที่ไหน บ่อยแค่ไหน',                                        1, true),
    ('F', '3-2-1 rule assessed (3 copies, 2 media, 1 offsite)',                               'ประเมินตามหลัก 3-2-1 (3 สำเนา 2 สื่อ 1 นอกสถานที่)',                            2, true),
    ('F', 'Test restore performed successfully',                                              'ทดสอบกู้คืนข้อมูลได้สำเร็จ',                                                      3, true),
    ('F', 'Backup of NVR/CCTV footage policy',                                                'นโยบายการสำรองภาพจากกล้องวงจรปิด',                                             4, true),
    ('F', 'Cloud backup option assessed',                                                     'ประเมินตัวเลือกสำรองข้อมูลบนคลาวด์',                                              5, true),
    ('F', 'Recovery time expectation agreed with management',                                 'ตกลงเวลากู้คืนที่ยอมรับได้กับผู้บริหาร',                                              6, true),
    -- G: Computers, Printers & Endpoints
    ('G', 'Endpoint inventory: user, model, age, OS version',                                 'ทะเบียนเครื่อง: ผู้ใช้ รุ่น อายุ เวอร์ชัน OS',                                        1, true),
    ('G', 'OS updates and antivirus status per machine',                                      'ตรวจสถานะอัปเดตและแอนตี้ไวรัสทุกเครื่อง',                                          2, true),
    ('G', 'Local admin rights reviewed',                                                      'ตรวจสิทธิ์ผู้ดูแลระบบเครื่อง',                                                     3, true),
    ('G', 'Printer inventory and consumables process',                                        'ทะเบียนเครื่องพิมพ์และการจัดการวัสดุสิ้นเปลือง',                                       4, true),
    ('G', 'Aging hardware flagged for replacement plan',                                      'ระบุเครื่องเก่าเพื่อวางแผนเปลี่ยน',                                                  5, true),
    ('G', 'Licensed software verified (Windows, Office)',                                     'ตรวจใบอนุญาตซอฟต์แวร์ (Windows, Office)',                                     6, true),
    -- H: Email & Microsoft 365
    ('H', 'License count vs actual users reconciled',                                         'เทียบจำนวนไลเซนส์กับผู้ใช้จริง',                                                  1, true),
    ('H', 'Admin accounts reviewed, unused accounts disabled',                                'ตรวจบัญชีผู้ดูแล ปิดบัญชีที่ไม่ใช้',                                                2, true),
    ('H', 'MFA enabled for all users (priority: admins)',                                     'เปิด MFA ทุกคน (เริ่มจากผู้ดูแล)',                                                3, true),
    ('H', 'Mailbox sizes and shared mailbox usage',                                           'ตรวจขนาดกล่องจดหมายและ shared mailbox',                                       4, true),
    ('H', 'SPF / DKIM / DMARC records verified',                                              'ตรวจ SPF DKIM DMARC',                                                        5, true),
    ('H', 'OneDrive/SharePoint usage and backup policy',                                      'ตรวจการใช้ OneDrive/SharePoint และนโยบายสำรอง',                                6, true),
    -- I: Security & Accounts
    ('I', 'Password policy assessed',                                                         'ประเมินนโยบายรหัสผ่าน',                                                        1, true),
    ('I', 'Shared account usage identified and reduced',                                      'ระบุและลดการใช้บัญชีร่วม',                                                       2, true),
    ('I', 'Ex-employee accounts disabled',                                                    'ปิดบัญชีพนักงานที่ลาออกแล้ว',                                                    3, true),
    ('I', 'Firewall rules / port forwarding reviewed',                                        'ตรวจกฎไฟร์วอลล์และ port forwarding',                                             4, true),
    ('I', 'Remote access methods audited (TeamViewer/VPN/etc.)',                              'ตรวจช่องทางรีโมต',                                                            5, true),
    ('I', 'Physical security of IT room/racks',                                               'ตรวจความปลอดภัยทางกายภาพของห้องหรือตู้ IT',                                    6, true),
    -- J: Weekly Visit Routine
    ('J', 'Check alerts: NVR, NAS, UPS, backup logs',                                         'ตรวจการแจ้งเตือน: NVR NAS UPS บันทึกสำรองข้อมูล',                                1, true),
    ('J', 'Walk-through: network room condition',                                             'เดินตรวจห้องเครือข่าย',                                                          2, true),
    ('J', 'Resolve staff-reported issues',                                                    'แก้ปัญหาที่พนักงานแจ้ง',                                                          3, true),
    ('J', 'Test one random restore / backup verify',                                          'สุ่มทดสอบการกู้คืนข้อมูล',                                                        4, true),
    ('J', 'CCTV spot check: all cameras recording',                                           'สุ่มตรวจกล้องบันทึกครบ',                                                          5, true),
    ('J', 'Update asset register with any changes',                                           'อัปเดตทะเบียนทรัพย์สิน',                                                         6, true),
    ('J', 'Log all work in visit record',                                                     'บันทึกงานที่ทำในรายงานการเข้าปฏิบัติงาน',                                            7, true),
    ('J', 'Send weekly summary (Friday)',                                                     'ส่งสรุปประจำสัปดาห์ (วันศุกร์)',                                                   8, true),
    -- K: Monthly Reporting
    ('K', 'Compile incidents and downtime for the month',                                     'รวบรวมเหตุขัดข้องและเวลาหยุดทำงาน',                                              1, true),
    ('K', 'Completed vs pending tasks summary',                                               'สรุปงานเสร็จและค้าง',                                                            2, true),
    ('K', 'Open risks with recommendation',                                                   'ความเสี่ยงคงค้างพร้อมข้อเสนอแนะ',                                                3, true),
    ('K', 'Next month plan + budget requests',                                                'แผนเดือนถัดไปและงบประมาณที่ขออนุมัติ',                                            4, true),
    ('K', 'Send invoice',                                                                     'ออกใบแจ้งหนี้',                                                                 5, true),
    ('K', 'Management review meeting (if needed)',                                            'ประชุมทบทวนกับผู้บริหาร (ถ้าจำเป็น)',                                             6, true),
    -- L: Audit Close-out & Handover
    ('L', 'Final audit report completed (all [TO FILL] filled)',                              'จัดทำรายงานตรวจสอบฉบับสมบูรณ์',                                                1, true),
    ('L', 'Presented to management team',                                                     'นำเสนอทีมผู้บริหาร',                                                            2, true),
    ('L', 'Quick wins completed and signed off',                                              'งานเร่งด่วนเสร็จและรับรอง',                                                      3, true),
    ('L', 'Short-term budget approved/rejected recorded',                                     'บันทึกผลอนุมัติงบประยะสั้น',                                                     4, true),
    ('L', 'Long-term project quotations submitted',                                           'ส่งใบเสนอราคาโครงการระยะยาว',                                                  5, true),
    ('L', 'All documentation stored in project folder',                                       'เก็บเอกสารทั้งหมดในโฟลเดอร์โครงการ',                                            6, true)
) AS x(code, text_en, text_th, sort_order, required) ON t.code = x.code
WHERE NOT EXISTS (
    SELECT 1 FROM checklist_template_items i
     WHERE i.template_id = t.id AND i.sort_order = x.sort_order
);
