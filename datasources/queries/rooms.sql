-- -------------------------------------------------------------
-- TablePlus 3.12.6(366)
--
-- https://tableplus.com/
--
-- Database: go_smallsite_bookings
-- Generation Time: 2564-05-15 10:19:28.7010
-- -------------------------------------------------------------


-- This script only contains the table creation statements and does not fully represent the table in the database. It's still missing: indices, triggers. Do not use it as a backup.

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS rooms_id_seq;

-- Table Definition
CREATE TABLE "public"."rooms" (
    "id" int4 NOT NULL DEFAULT nextval('rooms_id_seq'::regclass),
    "roomtype_id" int4 NOT NULL,
    "room_name" varchar(255) NOT NULL DEFAULT ''::character varying,
    "room_no" varchar(255) NOT NULL DEFAULT ''::character varying,
    "description" varchar(255) NOT NULL DEFAULT ''::character varying,
    "status" varchar(255) NOT NULL DEFAULT 'available'::character varying,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    PRIMARY KEY ("id")
);

INSERT INTO "public"."rooms" ("id", "roomtype_id", "room_name", "room_no", "description", "status", "created_at", "updated_at") VALUES
(1, 1, '101', '101', 'Building A Fl.3', 'available', '2021-05-11 18:39:17.600361', '2021-05-11 18:39:17.600361'),
(2, 2, '201', '201', 'Building A Fl.4', 'available', '2021-05-11 18:39:47.535036', '2021-05-11 18:39:47.535036'),
(3, 3, '301', '301', 'Beach front and beside with pool ', 'published', '2021-05-11 18:52:40.032437', '2021-05-11 18:52:40.032437');
