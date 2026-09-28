ALTER TABLE "notifications"
ADD COLUMN "source_event_id" UUID;

CREATE UNIQUE INDEX "notifications_source_event_id_key"
ON "notifications"("source_event_id");
