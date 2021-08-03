-- -------------------------------------------------------------
-- TablePlus 3.12.6(366)
--
-- https://tableplus.com/
--
-- Database: go_smallsite_bookings
-- Generation Time: 2564-05-15 10:19:52.5490
-- -------------------------------------------------------------


-- This script only contains the table creation statements and does not fully represent the table in the database. It's still missing: indices, triggers. Do not use it as a backup.

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS room_types_id_seq;

-- Table Definition
CREATE TABLE "public"."room_types" (
    "id" int4 NOT NULL DEFAULT nextval('room_types_id_seq'::regclass),
    "title" varchar(255) NOT NULL DEFAULT ''::character varying,
    "description" varchar(255) NOT NULL DEFAULT ''::character varying,
    "status" varchar(255) NOT NULL DEFAULT 'published'::character varying,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    PRIMARY KEY ("id")
);

INSERT INTO "public"."room_types" ("id", "title", "description", "status", "created_at", "updated_at") VALUES
(1, 'Superior', 'Superior room', 'published', '2021-05-11 16:09:50.858833', '2021-05-11 16:09:50.858833'),
(2, 'Deluxe', 'Deluxe Room Type', 'published', '2021-05-11 16:16:36.945684', '2021-05-11 16:16:36.945684'),
(3, 'Cabana', 'Cabana room type', 'published', '2021-05-11 16:34:58.664853', '2021-05-11 16:34:58.664853');
