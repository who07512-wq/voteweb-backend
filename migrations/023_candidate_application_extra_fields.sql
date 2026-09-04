-- Migration: 023_candidate_application_extra_fields.sql
-- Adds age, date_of_birth, gender, aadhar_number to candidate_applications

ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS age INTEGER,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS gender VARCHAR(10) CHECK (gender IN ('Male', 'Female', 'Other')),
  ADD COLUMN IF NOT EXISTS aadhar_number VARCHAR(20);

COMMENT ON COLUMN candidate_applications.age IS 'Age as per 10th certificate';
COMMENT ON COLUMN candidate_applications.date_of_birth IS 'Date of birth as per 10th certificate';
COMMENT ON COLUMN candidate_applications.gender IS 'Gender: Male, Female, or Other';
COMMENT ON COLUMN candidate_applications.aadhar_number IS 'Aadhar card number';
