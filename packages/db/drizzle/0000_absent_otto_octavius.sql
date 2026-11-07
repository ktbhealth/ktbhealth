CREATE TABLE `consultations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`patient_id` integer,
	`transcript` text NOT NULL,
	`anamnesis` text,
	`review` text,
	`engine` text,
	`source` text DEFAULT 'browser' NOT NULL,
	`status` text DEFAULT 'done' NOT NULL,
	`bot_id` text,
	`consent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`handle` text NOT NULL,
	`name` text,
	`is_guest` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_unique` ON `users` (`handle`);