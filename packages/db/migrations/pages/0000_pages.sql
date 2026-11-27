CREATE TABLE "page_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"translation_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_home" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"seo" jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_translations_status_check" CHECK ("pages_translations"."status" in ('draft', 'in_review', 'published', 'unpublished'))
);
--> statement-breakpoint
ALTER TABLE "page_blocks" ADD CONSTRAINT "page_blocks_translation_id_pages_translations_id_fk" FOREIGN KEY ("translation_id") REFERENCES "public"."pages_translations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages_translations" ADD CONSTRAINT "pages_translations_entity_id_pages_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages_translations" ADD CONSTRAINT "pages_translations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages_translations" ADD CONSTRAINT "pages_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_blocks_order_unique" ON "page_blocks" USING btree ("translation_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_home_unique" ON "pages" USING btree ("is_home") WHERE "pages"."is_home";--> statement-breakpoint
CREATE UNIQUE INDEX "pages_translations_entity_locale_unique" ON "pages_translations" USING btree ("entity_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_translations_locale_slug_unique" ON "pages_translations" USING btree ("locale","slug");--> statement-breakpoint
CREATE INDEX "pages_translations_list_idx" ON "pages_translations" USING btree ("locale","status","published_at" DESC NULLS LAST);--> statement-breakpoint
-- Existing instances: the default editor role gets the content permissions of the new module
-- (chapter 3, "角色"). New instances have no roles yet; they are seeded from the manifests.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", "p"."permission"
FROM "roles", (VALUES ('pages.edit'), ('pages.publish'), ('pages.delete')) AS "p"("permission")
WHERE "roles"."key" = 'editor'
ON CONFLICT DO NOTHING;
