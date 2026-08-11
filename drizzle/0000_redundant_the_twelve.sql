CREATE TABLE "ai_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid,
	"orthanc_study_id" varchar(128),
	"modality" varchar(50) NOT NULL,
	"region" varchar(100),
	"category" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"confidence" numeric(5, 2),
	"bounding_box" jsonb,
	"heatmap_ref" varchar(300),
	"suggested_differential" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"literature_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"similar_case_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reviewed_by" varchar(100),
	"reviewed_at" timestamp,
	"model_version" varchar(100) DEFAULT 'geraldos-review-1',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" varchar(50) NOT NULL,
	"recommendation" text NOT NULL,
	"rationale" text,
	"priority" varchar(20) DEFAULT 'routine' NOT NULL,
	"status" varchar(30) DEFAULT 'proposed' NOT NULL,
	"rule_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_module" varchar(50),
	"target_action" varchar(100),
	"target_payload" jsonb,
	"requested_by" varchar(100),
	"approved_by" varchar(100),
	"approved_at" timestamp,
	"executed_at" timestamp,
	"audit_ref" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"referral_id" uuid,
	"equipment_id" uuid,
	"radiographer_id" uuid,
	"scheduled_date" date NOT NULL,
	"scheduled_time" time NOT NULL,
	"duration" integer DEFAULT 30 NOT NULL,
	"modality" varchar(50) NOT NULL,
	"procedure" varchar(200) NOT NULL,
	"priority" varchar(20) DEFAULT 'routine' NOT NULL,
	"status" varchar(30) DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"checked_in" boolean DEFAULT false,
	"checked_in_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100),
	"action" varchar(100) NOT NULL,
	"module" varchar(50) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" varchar(100),
	"details" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(20) NOT NULL,
	"address" text,
	"phone" varchar(30),
	"email" varchar(255),
	"manager_name" varchar(200),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "employee_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"employee_number" varchar(30) NOT NULL,
	"department" varchar(100),
	"employment_type" varchar(30) DEFAULT 'full_time' NOT NULL,
	"branch_id" uuid,
	"start_date" date,
	"end_date" date,
	"hourly_rate" numeric(10, 2),
	"monthly_salary" numeric(12, 2),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_records_employee_number_unique" UNIQUE("employee_number")
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"modality" varchar(50) NOT NULL,
	"manufacturer" varchar(200),
	"model" varchar(200),
	"serial_number" varchar(100),
	"location" varchar(200),
	"status" varchar(30) DEFAULT 'operational' NOT NULL,
	"install_date" date,
	"last_calibration" date,
	"next_calibration" date,
	"utilization_rate" numeric(5, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"aggregate" varchar(50) NOT NULL,
	"aggregate_id" varchar(128),
	"payload" jsonb,
	"source" varchar(100) DEFAULT 'app' NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"idempotency_key" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" varchar(300) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"vendor" varchar(200),
	"branch_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"incurred_date" date NOT NULL,
	"approved_by" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_number" varchar(30) NOT NULL,
	"invoice_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"medical_aid" varchar(200) NOT NULL,
	"membership_number" varchar(100),
	"amount_claimed" numeric(12, 2) NOT NULL,
	"amount_approved" numeric(12, 2),
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp,
	"rejection_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_claims_claim_number_unique" UNIQUE("claim_number")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"category" varchar(50) NOT NULL,
	"sku" varchar(50),
	"current_stock" integer DEFAULT 0 NOT NULL,
	"minimum_stock" integer DEFAULT 10 NOT NULL,
	"maximum_stock" integer DEFAULT 100,
	"unit" varchar(30) DEFAULT 'units' NOT NULL,
	"unit_cost" numeric(10, 2),
	"supplier" varchar(200),
	"last_order_date" date,
	"expiry_date" date,
	"location" varchar(200),
	"status" varchar(20) DEFAULT 'in_stock' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"quantity" integer NOT NULL,
	"performed_by" varchar(200),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"tariff_id" uuid,
	"description" varchar(300) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(30) NOT NULL,
	"patient_id" uuid NOT NULL,
	"study_id" uuid,
	"appointment_id" uuid,
	"billing_type" varchar(20) DEFAULT 'cash' NOT NULL,
	"insurance_provider" varchar(200),
	"insurance_policy_number" varchar(100),
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(300) NOT NULL,
	"category" varchar(50) NOT NULL,
	"doc_type" varchar(50) DEFAULT 'guide' NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" varchar(20) DEFAULT '1.0' NOT NULL,
	"author" varchar(200),
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"approved_by" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"performed_by" varchar(200),
	"scheduled_date" date,
	"completed_date" date,
	"status" varchar(30) DEFAULT 'scheduled' NOT NULL,
	"cost" numeric(10, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(100) DEFAULT 'all' NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"type" varchar(30) DEFAULT 'info' NOT NULL,
	"severity" varchar(20) DEFAULT 'normal' NOT NULL,
	"link" varchar(300),
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mrn" varchar(20) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"date_of_birth" date NOT NULL,
	"gender" varchar(20) NOT NULL,
	"phone" varchar(30),
	"email" varchar(255),
	"address" text,
	"insurance_provider" varchar(200),
	"insurance_policy_number" varchar(100),
	"emergency_contact_name" varchar(200),
	"emergency_contact_phone" varchar(30),
	"consent_signed" boolean DEFAULT false,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patients_mrn_unique" UNIQUE("mrn")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_number" varchar(30) NOT NULL,
	"invoice_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" varchar(20) NOT NULL,
	"reference" varchar(100),
	"received_by" varchar(200),
	"received_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_receipt_number_unique" UNIQUE("receipt_number")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"referring_physician" varchar(200) NOT NULL,
	"referring_facility" varchar(200),
	"clinical_indication" text NOT NULL,
	"requested_procedure" varchar(200) NOT NULL,
	"priority" varchar(20) DEFAULT 'routine' NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"modality" varchar(50) NOT NULL,
	"description" varchar(300),
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"findings" text,
	"impression" text,
	"recommendation" text,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"quality_score" integer,
	"ai_assisted" boolean DEFAULT false NOT NULL,
	"changed_by" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid,
	"patient_id" uuid NOT NULL,
	"radiologist_id" uuid,
	"template_name" varchar(200),
	"findings" text,
	"impression" text,
	"recommendation" text,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"signed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" varchar(300),
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"role" varchar(50) NOT NULL,
	"specialization" varchar(100),
	"email" varchar(255),
	"phone" varchar(30),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid,
	"orthanc_study_id" varchar(128),
	"series_instance_uid" varchar(128),
	"tool" varchar(50) NOT NULL,
	"label" varchar(200),
	"data" jsonb NOT NULL,
	"created_by" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"study_id" uuid,
	"orthanc_study_id" varchar(128),
	"label" varchar(200),
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" varchar(100),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tariffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(30) NOT NULL,
	"description" varchar(300) NOT NULL,
	"modality" varchar(50) NOT NULL,
	"cash_price" numeric(10, 2) NOT NULL,
	"medical_aid_price" numeric(10, 2) NOT NULL,
	"nappi_code" varchar(30),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tariffs_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "workflow_studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid,
	"patient_id" uuid NOT NULL,
	"accession_number" varchar(50),
	"study_instance_uid" varchar(128),
	"modality" varchar(50) NOT NULL,
	"procedure" varchar(200) NOT NULL,
	"body_part" varchar(100),
	"stage" varchar(30) DEFAULT 'referral' NOT NULL,
	"radiologist_id" uuid,
	"priority" varchar(20) DEFAULT 'routine' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_studies_accession_number_unique" UNIQUE("accession_number")
);
--> statement-breakpoint
ALTER TABLE "ai_observations" ADD CONSTRAINT "ai_observations_study_id_workflow_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."workflow_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_radiographer_id_staff_id_fk" FOREIGN KEY ("radiographer_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_records" ADD CONSTRAINT "employee_records_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_records" ADD CONSTRAINT "employee_records_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tariff_id_tariffs_id_fk" FOREIGN KEY ("tariff_id") REFERENCES "public"."tariffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_study_id_workflow_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."workflow_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_study_id_workflow_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."workflow_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_radiologist_id_staff_id_fk" FOREIGN KEY ("radiologist_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_annotations" ADD CONSTRAINT "study_annotations_study_id_workflow_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."workflow_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_bookmarks" ADD CONSTRAINT "study_bookmarks_study_id_workflow_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."workflow_studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_studies" ADD CONSTRAINT "workflow_studies_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_studies" ADD CONSTRAINT "workflow_studies_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_studies" ADD CONSTRAINT "workflow_studies_radiologist_id_staff_id_fk" FOREIGN KEY ("radiologist_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;