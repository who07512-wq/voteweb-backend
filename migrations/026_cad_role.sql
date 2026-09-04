-- 026: CAD role (election monitor)
--
-- Strategy: create a NEW enum (user_role_v2) with all four roles and swap the
-- column to it via an explicit text cast. This works from ANY prior state
-- (fresh DB, or a DB left half-migrated by an earlier failed attempt) because
-- the cast does not care what type the column currently is. The old enum is
-- dropped best-effort; if a hidden dependency remains it is left orphaned —
-- harmless, since application code never references the type name directly
-- (role is read as text everywhere).

-- Fresh type name every concept, but fixed name is fine given the text cast
DO $$ BEGIN
  CREATE TYPE user_role_v2 AS ENUM ('STUDENT', 'CANDIDATE', 'ADMIN', 'CAD');
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- left over from an earlier attempt
END $$;

ALTER TABLE students ALTER COLUMN role DROP DEFAULT;

-- The explicit text cast works no matter what type `role` currently is
DO $$ BEGIN
  ALTER TABLE students ALTER COLUMN role TYPE user_role_v2 USING role::text::user_role_v2;
EXCEPTION
  WHEN undefined_object THEN NULL;  -- column already swapped
END $$;

ALTER TABLE students ALTER COLUMN role SET DEFAULT 'STUDENT';

-- Best-effort cleanup of the old enum(s); leftovers are harmless
DO $$ BEGIN
  DROP TYPE IF EXISTS user_role_old;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  DROP TYPE IF EXISTS user_role;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
