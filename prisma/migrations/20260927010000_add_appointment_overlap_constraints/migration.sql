CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointments"
ADD CONSTRAINT "appointments_no_active_service_overlap"
EXCLUDE USING gist (
  "service_id" WITH =,
  tstzrange("start_time", "end_time", '[)') WITH &&
)
WHERE ("status" IN ('PENDING', 'CONFIRMED'));

ALTER TABLE "appointments"
ADD CONSTRAINT "appointments_no_active_customer_overlap"
EXCLUDE USING gist (
  "customer_id" WITH =,
  tstzrange("start_time", "end_time", '[)') WITH &&
)
WHERE ("status" IN ('PENDING', 'CONFIRMED'));
