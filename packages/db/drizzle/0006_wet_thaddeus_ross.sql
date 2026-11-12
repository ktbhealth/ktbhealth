CREATE TABLE `doctors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`crm` text,
	`specialty` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doctors_user_id_unique` ON `doctors` (`user_id`);--> statement-breakpoint
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
CREATE INDEX `doctor_access_email_idx` ON `doctor_access` (`email`);--> statement-breakpoint
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
CREATE INDEX `patient_access_email_idx` ON `patient_access` (`email`);--> statement-breakpoint
ALTER TABLE `user` ADD `cpf` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_cpf_unique` ON `user` (`cpf`);