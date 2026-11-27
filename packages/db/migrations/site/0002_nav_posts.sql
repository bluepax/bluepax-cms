ALTER TABLE "nav_items" ADD COLUMN "post_category_id" uuid;--> statement-breakpoint
ALTER TABLE "nav_items" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "nav_items" ADD CONSTRAINT "nav_items_post_category_id_post_categories_id_fk" FOREIGN KEY ("post_category_id") REFERENCES "public"."post_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_items" ADD CONSTRAINT "nav_items_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nav_items_post_category_idx" ON "nav_items" USING btree ("post_category_id");--> statement-breakpoint
CREATE INDEX "nav_items_post_idx" ON "nav_items" USING btree ("post_id");