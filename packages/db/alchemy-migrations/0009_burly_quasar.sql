CREATE TABLE `plugin_state` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config` text,
	`updated_at` integer NOT NULL
);
