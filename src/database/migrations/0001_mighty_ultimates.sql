CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
ALTER TABLE "library_item" ADD COLUMN "processing_status" "processing_status" DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "library_item" ADD COLUMN "content" text;