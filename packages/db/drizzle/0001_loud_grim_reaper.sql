PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_patients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_patients`("id", "owner_id", "name", "created_at") SELECT "id", "owner_id", "name", "created_at" FROM `patients`;--> statement-breakpoint
DROP TABLE `patients`;--> statement-breakpoint
ALTER TABLE `__new_patients` RENAME TO `patients`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_consultations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`patient_id` integer,
	`transcript` text NOT NULL,
	`anamnesis` text,
	`review` text,
	`engine` text,
	`source` text DEFAULT 'browser' NOT NULL,
	`status` text DEFAULT 'done' NOT NULL,
	`bot_id` text,
	`consent_at` integer,
	`audio_key` text,
	`audio_status` text DEFAULT 'none' NOT NULL,
	`audio_content_type` text,
	`audio_size` integer,
	`audio_error` text,
	`server_transcript` text,
	`corrected_transcript` text,
	`enhancement_engine` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_consultations`("id", "user_id", "patient_id", "transcript", "anamnesis", "review", "engine", "source", "status", "bot_id", "consent_at", "audio_key", "audio_status", "audio_content_type", "audio_size", "audio_error", "server_transcript", "corrected_transcript", "enhancement_engine", "created_at") SELECT "id", "user_id", "patient_id", "transcript", "anamnesis", "review", "engine", "source", "status", "bot_id", "consent_at", NULL, 'none', NULL, NULL, NULL, NULL, NULL, NULL, "created_at" FROM `consultations`;--> statement-breakpoint
DROP TABLE `consultations`;--> statement-breakpoint
ALTER TABLE `__new_consultations` RENAME TO `consultations`;