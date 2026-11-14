-- Every pre-existing account is a doctor (the only account kind before
-- doctor/patient portals). Idempotent: users that already have a profile
-- are skipped.
INSERT INTO `doctors` (`user_id`, `display_name`)
SELECT `id`, `name` FROM `user`
WHERE `id` NOT IN (SELECT `user_id` FROM `doctors`);
