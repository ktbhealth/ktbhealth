CREATE TABLE `patient_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`patient_id` integer NOT NULL,
	`user_id` text,
	`email` text,
	`relation` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`granted_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_access_patient_user_idx` ON `patient_access` (`patient_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `patient_access_user_idx` ON `patient_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `patient_access_email_idx` ON `patient_access` (`email`);