CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"key" text NOT NULL,
	"width" integer,
	"height" integer,
	"alt" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uploaded_by" uuid,
	"replaced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"key" text NOT NULL,
	"driver" text NOT NULL,
	"status" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"synced_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"module" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"field" text NOT NULL,
	"locale" text DEFAULT '' NOT NULL,
	"purpose" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_folder_id_media_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."media_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_parent_id_media_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_sha256_unique" ON "media" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "media_key_unique" ON "media" USING btree ("key");--> statement-breakpoint
CREATE INDEX "media_folder_idx" ON "media" USING btree ("folder_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "media_created_idx" ON "media" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "media_folders_name_unique" ON "media_folders" USING btree (coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "media_objects_driver_key_unique" ON "media_objects" USING btree ("driver","key");--> statement-breakpoint
CREATE INDEX "media_objects_media_idx" ON "media_objects" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "media_objects_status_idx" ON "media_objects" USING btree ("driver","status");--> statement-breakpoint
CREATE UNIQUE INDEX "media_usages_unique" ON "media_usages" USING btree ("media_id","module","target_type","target_id","field","locale");--> statement-breakpoint
CREATE INDEX "media_usages_target_idx" ON "media_usages" USING btree ("module","target_type","target_id");--> statement-breakpoint
-- Existing instances: the default editor role gets the content permission of the new module
-- (chapter 3, "角色"). New instances have no roles yet; they are seeded from the manifests.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'media.edit' FROM "roles" WHERE "key" = 'editor'
ON CONFLICT DO NOTHING;
