CREATE TABLE "CrisisEvent" (
	"chatId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matchedRuleIds" jsonb NOT NULL,
	"messageText" text NOT NULL,
	"userId" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CrisisEvent" ADD CONSTRAINT "CrisisEvent_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."Chat"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "CrisisEvent" ADD CONSTRAINT "CrisisEvent_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
