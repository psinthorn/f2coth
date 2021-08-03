-- -------------------------------------------------------------
-- TablePlus 3.12.6(366)
--
-- https://tableplus.com/
--
-- Database: go_smallsite_bookings
-- Generation Time: 2564-05-15 10:21:03.3240
-- -------------------------------------------------------------


-- This script only contains the table creation statements and does not fully represent the table in the database. It's still missing: indices, triggers. Do not use it as a backup.

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS room_status_id_seq;

-- Table Definition
CREATE TABLE "public"."room_status" (
    "id" int4 NOT NULL DEFAULT nextval('room_status_id_seq'::regclass),
    "title" varchar(255) NOT NULL DEFAULT ''::character varying,
    "symbol" varchar(255) NOT NULL DEFAULT ''::character varying,
    "description" varchar(255) NOT NULL DEFAULT ''::character varying,
    "status" varchar(255) NOT NULL DEFAULT ''::character varying,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    PRIMARY KEY ("id")
);

INSERT INTO "public"."room_status" ("id", "title", "symbol", "description", "status", "created_at", "updated_at") VALUES
(1, 'Available', 'AV', 'Room is available and ready for booking', 'published', '2021-05-11 18:41:00.944049', '2021-05-11 18:41:00.944049'),
(2, 'Stay', 'ST', 'Guest checked-in and stay and room', 'published', '2021-05-11 18:41:41.462787', '2021-05-11 18:41:41.462788'),
(3, 'Make room', 'MR', 'Maid is on make room for guest ', 'published', '2021-05-11 18:43:11.192766', '2021-05-11 18:43:11.192766'),
(4, 'Maintenance', 'MA', 'Maintenace room is close for maintenance reason', 'published', '2021-05-11 18:43:12.136818', '2021-05-11 18:43:12.136818'),
(5, 'Closed', 'CL', 'Long term closed ', 'published', '2021-05-11 18:49:41.33323', '2021-05-11 18:49:41.33323'),
(6, 'Block', 'BL', 'Blocking not alloow make reservation', 'published', '2021-05-14 07:36:51.680227', '2021-05-14 07:36:51.680227');
