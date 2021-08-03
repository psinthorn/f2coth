-- -------------------------------------------------------------
-- TablePlus 3.12.6(366)
--
-- https://tableplus.com/
--
-- Database: go_smallsite_bookings
-- Generation Time: 2564-05-15 10:20:23.3880
-- -------------------------------------------------------------


-- This script only contains the table creation statements and does not fully represent the table in the database. It's still missing: indices, triggers. Do not use it as a backup.

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS reservations_id_seq;

-- Table Definition
CREATE TABLE "public"."reservations" (
    "id" int4 NOT NULL DEFAULT nextval('reservations_id_seq'::regclass),
    "first_name" varchar(255) NOT NULL DEFAULT ''::character varying,
    "last_name" varchar(255) NOT NULL DEFAULT ''::character varying,
    "email" varchar(255) NOT NULL,
    "phone" varchar(255) NOT NULL DEFAULT ''::character varying,
    "room_id" int4 NOT NULL,
    "status" varchar(255) NOT NULL DEFAULT 'available'::character varying,
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    CONSTRAINT "reservations_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("id")
);

INSERT INTO "public"."reservations" ("id", "first_name", "last_name", "email", "phone", "room_id", "status", "start_date", "end_date", "created_at", "updated_at") VALUES
(2, 'Sinthorn', 'Pradutnam', 'psinthorn@gmail.com', '999 999 9999', 1, 'stay', '2021-05-13', '2021-05-15', '2021-05-11 19:39:48.090635', '2021-05-11 19:39:48.090635'),
(3, 'Na Phansa', 'Pradutnam', 'naphansa@gmail.com', '999 999 9999', 1, 'stay', '2021-05-21', '2021-05-30', '2021-05-11 19:43:35.038163', '2021-05-11 19:43:35.038163'),
(4, 'Sin', 'Pr', 'sin@pr.com', '888 888 8888', 1, 'stay', '2021-06-20', '2021-06-21', '2021-05-12 09:53:39.50718', '2021-05-12 09:53:39.50718'),
(5, 'Sinthorn', 'Prdutnam', 'p@s.com', '000 000 0000', 1, 'stay', '2021-05-29', '2021-06-02', '2021-05-14 13:19:23.861987', '2021-05-14 13:19:23.861988'),
(6, 'ppp', 'sss', 'ppp@sss.com', '999 999 9999', 1, 'stay', '2021-06-03', '2021-06-05', '2021-05-14 19:03:58.372129', '2021-05-14 19:03:58.372129'),
(7, 'sss', 'ppp', 'sss@ppp.com', '999 999 9999', 1, 'stay', '2021-06-03', '2021-06-05', '2021-05-14 20:43:15.315977', '2021-05-14 20:43:15.315977'),
(8, 'ddd', 'fff', 'ddd@fff.com', '777 777 7777', 1, 'stay', '2021-06-03', '2021-06-05', '2021-05-14 20:43:56.957251', '2021-05-14 20:43:56.957251');
