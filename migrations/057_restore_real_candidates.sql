-- Migration: 057_restore_real_candidates.sql
-- 056 removed ALL election data including real student candidate applications.
-- No Postgres snapshot / Appwrite db-backups bucket / audit trail existed, so
-- bio, manifesto, phone, DOB, Aadhar, and contesting_position are unrecoverable.
-- This restores the 15 REAL candidates (proof = surviving Appwrite candidate-photos)
-- as approved applications with their student data + photo, position_id/election_id
-- NULL so they can be placed after the user creates the election manually.
-- phone is NOT NULL with no recoverable value (wipe + no backup), so a placeholder
-- '0000000000' is used; admin should correct it when reviewing candidates.
-- The 6 mock TEST candidates (who07512, ctrlplusz069, cartoonwithindian, jfjrihrje,
-- draza108, madea.official) are intentionally NOT restored.
-- Idempotent: skips students who already have an approved application.

INSERT INTO candidate_applications (
  student_id, full_name, enrollment_number, department, year, semester, section,
  position_id, contesting_position, email, phone, profile_photo_url, bio, manifesto,
  age, date_of_birth, gender, aadhar_number, category, election_id,
  status, submitted_at, created_at, updated_at
)
SELECT
  s.id,
  s.name,
  COALESCE(s.external_id, '') || COALESCE(s.email, ''),
  COALESCE(s.department, ''),
  c.ylabel,
  c.ylabel,
  COALESCE(s.section, ''),
  NULL, NULL, s.email, '0000000000', purl, NULL, NULL,
  NULL, NULL, NULL, NULL, 'CR', NULL,
  'approved', NOW(), NOW(), NOW()
FROM (VALUES
  ('loveahuja029@gmail.com',      '6aae4d02000708165e32', '5 Sem'),
  ('kanishka3316@gmail.com',      '6aae656b0027a8069973', '5 Sem'),
  ('bhoomigupta1124@gmail.com',   '6aaea619000506a50f5e', '5 Sem'),
  ('vasudevrana2005@gmail.com',   '6aaea326003ba2a4a815', '5 Sem'),
  ('ananyajha266@gmail.com',      '6aaeb8fd00084225c3b8', '5 Sem'),
  ('mayanksahni2256@gmail.com',   '6aae526500272cedfc10', '3 Sem'),
  ('pahujasaksham39@gmail.com',   '6aae1a12003929485a1a', '3 Sem'),
  ('bilalkhan00612@gmail.com',    '6aacd3d4001b68fd68e6', '3 Sem'),
  ('emailerakhan@gmail.com',      '6aaec9220018654c8058', '1 Sem'),
  ('janpreetsr@gmail.com',        '6aaeb7d4000566f5061c', '1 Sem'),
  ('takshitkhurana16@gmail.com',  '6aaecb3b001873c37bc7', '1 Sem'),
  ('mannatchopra17@gmail.com',    '6aae43e20032779772b7', '1 Sem'),
  ('gomsisingh027@gmail.com',     '6aae13bc00047e409d33', '1 Sem'),
  ('kajalsamantarya620@gmail.com','6aae53040023be2f41eb', '1 Sem'),
  ('arbaazkha2002@gmail.com',     '6aae0840001e1d79a324', '3 Sem')
) AS c(email, file_id, ylabel)
JOIN students s ON LOWER(s.email) = LOWER(c.email)
CROSS JOIN LATERAL (
  SELECT 'https://fra.cloud.appwrite.io/v1/storage/buckets/candidate-photos/files/' ||
         c.file_id || '/view?project=6a961a3200335ef36ba8' AS purl
) p
WHERE NOT EXISTS (
  SELECT 1 FROM candidate_applications ca
  WHERE ca.student_id = s.id AND ca.status = 'approved'
);