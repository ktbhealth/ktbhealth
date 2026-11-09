ALTER TABLE `patients` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `patients` ADD `social_name` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `gender` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `birth_date` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `cpf` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `cns` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `passport` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `email` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `preferred_language` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `address_line` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `address_number` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `address_complement` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `district` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `city` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `state` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `postal_code` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `country` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `mother_name` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `marital_status` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `race_color` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `nationality` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `emergency_contact_name` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `emergency_contact_relationship` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `emergency_contact_phone` text;--> statement-breakpoint
ALTER TABLE `patients` ADD `updated_at` integer;