-- GER-001: Production security + reconciliation idempotency
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_workflow_studies_study_uid" ON "workflow_studies" ("study_instance_uid") WHERE "study_instance_uid" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_workflow_studies_patient" ON "workflow_studies" ("patient_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_workflow_studies_stage" ON "workflow_studies" ("stage");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_workflow_studies_created" ON "workflow_studies" ("created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_event_log_type" ON "event_log" ("event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_audit_log_entity" ON "audit_log" ("entity_type", "entity_id");
--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_event_log_idempotency" ON "event_log" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
-- Reconciliation DLQ: stores failed reconciliations for manual review
CREATE TABLE IF NOT EXISTS "reconciliation_failures" (
  "id" serial PRIMARY KEY NOT NULL,
  "orthanc_change_id" integer,
  "study_instance_uid" varchar(128),
  "orthanc_study_id" varchar(128),
  "failure_reason" text NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp
);
