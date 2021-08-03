-- -------------------------------------------------------------
-- TablePlus 3.12.6(366)
--
-- https://tableplus.com/
--
-- Database: go_smallsite_bookings
-- Generation Time: 2564-05-15 10:20:42.4620
-- -------------------------------------------------------------


-- This script only contains the table creation statements and does not fully represent the table in the database. It's still missing: indices, triggers. Do not use it as a backup.

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS room_allotments_id_seq;

-- Table Definition
CREATE TABLE "public"."room_allotments" (
    "id" int4 NOT NULL DEFAULT nextval('room_allotments_id_seq'::regclass),
    "room_type_id" int4 NOT NULL,
    "room_no_id" int4 NOT NULL,
    "room_status_id" int4 NOT NULL,
    "reservation_id" int4,
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    CONSTRAINT "room_allotments_rooms_id_fk" FOREIGN KEY ("room_no_id") REFERENCES "public"."rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "room_allotments_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "room_allotments_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "room_allotments_room_status_id_fk" FOREIGN KEY ("room_status_id") REFERENCES "public"."room_status"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("id")
);

INSERT INTO "public"."room_allotments" ("id", "room_type_id", "room_no_id", "room_status_id", "reservation_id", "start_date", "end_date", "created_at", "updated_at") VALUES
(1, 1, 1, 2, 2, '2021-05-13', '2021-05-15', '2021-05-11 19:39:48.108548', '2021-05-11 19:39:48.108549'),
(2, 1, 1, 2, 3, '2021-05-21', '2021-05-30', '2021-05-11 19:43:35.053778', '2021-05-11 19:43:35.053778'),
(3, 1, 1, 2, 4, '2021-06-20', '2021-06-21', '2021-05-12 09:53:39.528872', '2021-05-12 09:53:39.528872'),
(4, 1, 1, 2, 5, '2021-05-29', '2021-06-02', '2021-05-14 13:19:23.88483', '2021-05-14 13:19:23.884831'),
(5, 1, 1, 2, 6, '2021-06-03', '2021-06-05', '2021-05-14 19:03:58.387394', '2021-05-14 19:03:58.387395'),
(6, 2, 2, 2, 7, '2021-06-03', '2021-06-05', '2021-05-14 20:43:15.334107', '2021-05-14 20:43:15.334108'),
(7, 3, 3, 2, 8, '2021-06-03', '2021-06-05', '2021-05-14 20:43:56.971692', '2021-05-14 20:43:56.971692');
