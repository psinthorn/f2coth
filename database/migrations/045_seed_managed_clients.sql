-- =============================================================
-- 045_seed_managed_clients.sql
-- Seed additional managed clients under active F2 stewardship.
-- Contact details left NULL — F2 admin to populate on next portal
-- hand-off. `notes` carries the authoritative service + domain list.
-- =============================================================

INSERT INTO customers (slug, name, industry, services_used, notes, is_active)
VALUES
    ('library-koh-samui',
     'The Library Koh Samui',
     'Luxury Boutique Resort',
     ARRAY['domain-hosting'],
     'Domain registration and DNS service. Koh Samui property.',
     TRUE),

    ('diamond-pool-villas-samui',
     'Diamond Pool Villas Koh Samui',
     'Pool Villa Rentals & Transportation',
     ARRAY['domain-hosting','digital-transformation'],
     'Domain + DNS service for diamondpoolvillasamui.com (pool villa website) and rungruangsubsamui.com (transportation website). F2 also builds and maintains both websites.',
     TRUE),

    ('theatre-residence',
     'The Theatre Residence',
     'Luxury Residence',
     ARRAY['domain-hosting'],
     'Domain and DNS service for theatreresidence.com.',
     TRUE),

    ('samui-natien',
     'Samui Natien',
     'Hospitality',
     ARRAY['domain-hosting'],
     'Business email service.',
     TRUE),

    ('samui-arena',
     'Samui Arena',
     'Sports & Entertainment Venue',
     ARRAY['domain-hosting'],
     'Domain, DNS and hosting service for samuiarena.com.',
     TRUE),

    ('jm-asia',
     'JM Asia',
     'Regional Business',
     ARRAY['domain-hosting'],
     'Domain, DNS and Google Workspace administration.',
     TRUE)
ON CONFLICT (slug) DO UPDATE SET
    name          = EXCLUDED.name,
    industry      = EXCLUDED.industry,
    services_used = EXCLUDED.services_used,
    notes         = EXCLUDED.notes,
    is_active     = EXCLUDED.is_active;
