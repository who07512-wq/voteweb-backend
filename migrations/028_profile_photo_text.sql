-- 028: profile photo storage
--
-- The application form stores the uploaded photo as a base64 data URL,
-- which is far longer than the original VARCHAR(500) — every submission
-- with a photo failed with "value too long for type character varying(500)".
-- TEXT removes the practical limit. Pairing with client-side downscaling
-- (max 512px JPEG) keeps payloads small.

ALTER TABLE candidate_applications ALTER COLUMN profile_photo_url TYPE TEXT;
