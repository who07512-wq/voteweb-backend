-- 026: CAD role (election monitor)
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_role_check;
DO $$ BEGIN
  CREATE TYPE user_role_new AS ENUM ('STUDENT', 'CANDIDATE', 'ADMIN', 'CAD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
UPDATE students SET role = 'CAD'::user_role_new WHERE role::text = 'CAD';
ALTER TABLE students ALTER COLUMN role TYPE user_role_new USING role::text::user_role_new;
DROP TYPE IF EXISTS user_role CASCADE;
ALTER TYPE user_role_new RENAME TO user_role;
