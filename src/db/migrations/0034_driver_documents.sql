-- Private driver documents: current driving license and insurance only.
CREATE TABLE IF NOT EXISTS "driver_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "document_type" varchar(32) NOT NULL,
  "original_filename" varchar(255) NOT NULL,
  "mime_type" varchar(100) NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_key" text NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "driver_documents_type_check"
    CHECK ("document_type" IN ('driving_license', 'insurance')),
  CONSTRAINT "driver_documents_size_check"
    CHECK ("size_bytes" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_driver_documents_driver_type"
  ON "driver_documents" ("driver_id", "document_type");

CREATE INDEX IF NOT EXISTS "idx_driver_documents_driver_id"
  ON "driver_documents" ("driver_id");
