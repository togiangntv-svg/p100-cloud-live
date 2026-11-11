-- Validation only: never fed to drizzle-kit push or a production migration runner.
-- Constraint indexes/composite row types inherit their explicitly qualified parent table's schema.
CREATE TABLE identity02_test_v01.identity02_subjects (
  subject_id uuid PRIMARY KEY,
  control_ref uuid NOT NULL UNIQUE,
  profile_id uuid NOT NULL UNIQUE,
  status varchar(8) NOT NULL CHECK (status = 'ACTIVE'),
  created_at timestamptz NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1)
);
CREATE TABLE identity02_test_v01.identity02_profiles (
  profile_id uuid PRIMARY KEY,
  subject_id uuid NOT NULL UNIQUE REFERENCES identity02_test_v01.identity02_subjects(subject_id) ON DELETE RESTRICT,
  status varchar(8) NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  UNIQUE (subject_id, profile_id)
);
ALTER TABLE identity02_test_v01.identity02_subjects
  ADD CONSTRAINT identity02_subject_profile_required
  FOREIGN KEY (subject_id, profile_id)
  REFERENCES identity02_test_v01.identity02_profiles(subject_id, profile_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE identity02_test_v01.identity02_goal_states (
  profile_id uuid PRIMARY KEY REFERENCES identity02_test_v01.identity02_profiles(profile_id) ON DELETE RESTRICT,
  state varchar(9) NOT NULL CHECK (state IN ('UNKNOWN','NONE','CONFIRMED')),
  revision integer NOT NULL CHECK (revision >= 1),
  updated_at timestamptz NOT NULL
);
CREATE TABLE identity02_test_v01.identity02_creations (
  request_key_digest varchar(64) PRIMARY KEY CHECK (request_key_digest ~ '^[0-9a-f]{64}$'),
  subject_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  receipt_version integer NOT NULL CHECK (receipt_version = 1),
  recorded_at timestamptz NOT NULL,
  FOREIGN KEY (subject_id, profile_id) REFERENCES identity02_test_v01.identity02_profiles(subject_id, profile_id) ON DELETE RESTRICT
);
