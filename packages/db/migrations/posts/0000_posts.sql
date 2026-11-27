CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"avatar" uuid,
	"same_as" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_page" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authors_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"job_title" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"seo" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_author_links" (
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "post_author_links_post_id_author_id_pk" PRIMARY KEY("post_id","author_id")
);
--> statement-breakpoint
CREATE TABLE "post_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_categories_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"seo" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_category_links" (
	"post_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "post_category_links_post_id_category_id_pk" PRIMARY KEY("post_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "post_tag_links" (
	"post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "post_tag_links_post_id_tag_id_pk" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cover" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"body" jsonb NOT NULL,
	"key_takeaways" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"published_at" timestamp with time zone,
	"modified_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"seo" jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_translations_status_check" CHECK ("posts_translations"."status" in ('draft', 'in_review', 'published', 'unpublished')),
	CONSTRAINT "posts_translations_source_check" CHECK ("posts_translations"."source" in ('manual', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"seo" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authors_translations" ADD CONSTRAINT "authors_translations_entity_id_authors_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_author_links" ADD CONSTRAINT "post_author_links_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_author_links" ADD CONSTRAINT "post_author_links_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_categories_translations" ADD CONSTRAINT "post_categories_translations_entity_id_post_categories_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."post_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_category_links" ADD CONSTRAINT "post_category_links_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_category_links" ADD CONSTRAINT "post_category_links_category_id_post_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."post_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tag_links" ADD CONSTRAINT "post_tag_links_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tag_links" ADD CONSTRAINT "post_tag_links_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts_translations" ADD CONSTRAINT "posts_translations_entity_id_posts_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts_translations" ADD CONSTRAINT "posts_translations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts_translations" ADD CONSTRAINT "posts_translations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags_translations" ADD CONSTRAINT "tags_translations_entity_id_tags_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authors_user_unique" ON "authors" USING btree ("user_id") WHERE "authors"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "authors_translations_entity_locale_unique" ON "authors_translations" USING btree ("entity_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "authors_translations_locale_slug_unique" ON "authors_translations" USING btree ("locale","slug");--> statement-breakpoint
CREATE INDEX "post_author_links_author_idx" ON "post_author_links" USING btree ("author_id","post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_categories_translations_entity_locale_unique" ON "post_categories_translations" USING btree ("entity_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "post_categories_translations_locale_slug_unique" ON "post_categories_translations" USING btree ("locale","slug");--> statement-breakpoint
CREATE INDEX "post_category_links_category_idx" ON "post_category_links" USING btree ("category_id","post_id");--> statement-breakpoint
CREATE INDEX "post_tag_links_tag_idx" ON "post_tag_links" USING btree ("tag_id","post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_translations_entity_locale_unique" ON "posts_translations" USING btree ("entity_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_translations_locale_slug_unique" ON "posts_translations" USING btree ("locale","slug");--> statement-breakpoint
CREATE INDEX "posts_translations_list_idx" ON "posts_translations" USING btree ("locale","status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "tags_translations_entity_locale_unique" ON "tags_translations" USING btree ("entity_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_translations_locale_slug_unique" ON "tags_translations" USING btree ("locale","slug");--> statement-breakpoint
-- Existing instances: the default editor role gets the content permissions of the new module
-- (chapter 3, "角色"). New instances have no roles yet; they are seeded from the manifests.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "roles"."id", "p"."permission"
FROM "roles", (VALUES ('posts.edit'), ('posts.publish'), ('posts.delete'), ('posts.taxonomy'), ('posts.authors')) AS "p"("permission")
WHERE "roles"."key" = 'editor'
ON CONFLICT DO NOTHING;
