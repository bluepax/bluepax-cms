ALTER TABLE "nav_items" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "nav_items" ADD CONSTRAINT "nav_items_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nav_items_page_idx" ON "nav_items" USING btree ("page_id");