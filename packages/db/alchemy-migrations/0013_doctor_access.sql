CREATE TABLE `doctor_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doctor_id` integer NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`role` text DEFAULT 'secretary' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`invited_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`doctor_id`) REFERENCES `doctors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doctor_access_doctor_email_idx` ON `doctor_access` (`doctor_id`,`email`);--> statement-breakpoint
CREATE INDEX `doctor_access_user_idx` ON `doctor_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `doctor_access_email_idx` ON `doctor_access` (`email`);