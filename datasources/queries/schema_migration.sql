-- -------------------------------------------------------------
-- TablePlus 3.12.6(366)
--
-- https://tableplus.com/
--
-- Database: go_smallsite_bookings
-- Generation Time: 2564-05-11 18:31:25.4160
-- -------------------------------------------------------------


DROP TABLE IF EXISTS "public"."schema_migration";
-- This script only contains the table creation statements and does not fully represent the table in the database. It's still missing: indices, triggers. Do not use it as a backup.

-- Table Definition
CREATE TABLE "public"."schema_migration" (
    "version" varchar(14) NOT NULL
);

INSERT INTO "public"."schema_migration" ("version") VALUES
('20210416160841'),
('20210416163651'),
('20210416163701'),
('20210416165042'),
('20210416165056'),
('20210417021420'),
('20210418003723'),
('20210418004406'),
('20210418005710'),
('20210511050009'),
('20210511060258');
