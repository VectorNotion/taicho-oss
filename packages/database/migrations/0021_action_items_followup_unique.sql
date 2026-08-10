CREATE UNIQUE INDEX "uniq_action_items_open_auto_followup" ON "action_items" USING btree ("organization_id","prospect_id") WHERE (status = 'open' AND source = 'auto_followup');
