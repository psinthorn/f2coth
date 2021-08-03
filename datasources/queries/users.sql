-- -------------------------------------------------------------
-- TablePlus 3.12.6(366)
--
-- https://tableplus.com/
--
-- Database: go_smallsite_bookings
-- Generation Time: 2564-05-15 10:19:03.7750
-- -------------------------------------------------------------


-- This script only contains the table creation statements and does not fully represent the table in the database. It's still missing: indices, triggers. Do not use it as a backup.

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS users_id_seq;

-- Table Definition
CREATE TABLE "public"."users" (
    "id" int4 NOT NULL DEFAULT nextval('users_id_seq'::regclass),
    "first_name" varchar(255) NOT NULL DEFAULT ''::character varying,
    "last_name" varchar(255) NOT NULL DEFAULT ''::character varying,
    "email" varchar(255) NOT NULL,
    "password" varchar(60) NOT NULL,
    "access_level" int4 NOT NULL DEFAULT 1,
    "status" varchar(255) NOT NULL,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    PRIMARY KEY ("id")
);

INSERT INTO "public"."users" ("id", "first_name", "last_name", "email", "password", "access_level", "status", "created_at", "updated_at") VALUES
(1, 'Sinthorn', 'Pradutnam', 'psinthorn@gmail.com', 'pordwass', 1, 'published', '2021-05-12 13:41:08.992021', '2021-05-12 13:41:08.992021');
