ALTER TABLE "MemorySummary" ADD COLUMN "coveredFromMessageId" uuid;--> statement-breakpoint
ALTER TABLE "MemorySummary" ADD COLUMN "coveredToMessageId" uuid;--> statement-breakpoint
ALTER TABLE "MemorySummary" ADD COLUMN "coveredTurns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "MemorySummary" ADD COLUMN "status" varchar DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "MemorySummary" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;