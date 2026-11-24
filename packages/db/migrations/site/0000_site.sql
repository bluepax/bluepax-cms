CREATE TABLE "entity_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"postal_code" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"opening_hours" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"legal_name" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"role" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"registration_number" text DEFAULT '' NOT NULL,
	"registration_number_public" boolean DEFAULT false NOT NULL,
	"tax_id" text DEFAULT '' NOT NULL,
	"tax_id_public" boolean DEFAULT false NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nav_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu" text NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"label" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"new_tab" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_locations" ADD CONSTRAINT "entity_locations_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_items" ADD CONSTRAINT "nav_items_parent_id_nav_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."nav_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_locations_entity_idx" ON "entity_locations" USING btree ("entity_id","sort_order");--> statement-breakpoint
CREATE INDEX "nav_items_menu_idx" ON "nav_items" USING btree ("menu","sort_order");--> statement-breakpoint
CREATE INDEX "nav_items_parent_idx" ON "nav_items" USING btree ("parent_id");