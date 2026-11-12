ALTER TABLE `patients` ADD `tenant_id` integer REFERENCES groups(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `patients_tenant_id_idx` ON `patients` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `consultations` ADD `tenant_id` integer REFERENCES groups(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `consultations_tenant_id_idx` ON `consultations` (`tenant_id`);