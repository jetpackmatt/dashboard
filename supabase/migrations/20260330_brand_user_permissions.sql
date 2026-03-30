-- Brand User Permissions System
-- Adds granular permission support for brand team members.
-- brand_owner = full access (permissions NULL)
-- brand_team = custom permissions via JSONB

-- Step 1: Add permissions JSONB column
ALTER TABLE user_clients ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT NULL;

-- Step 2: Drop old constraint BEFORE updating roles (old constraint only allows owner/editor/viewer)
ALTER TABLE user_clients DROP CONSTRAINT IF EXISTS user_clients_role_check;

-- Step 3: Migrate existing roles to new values
UPDATE user_clients SET role = 'brand_owner' WHERE role = 'owner';
UPDATE user_clients SET role = 'brand_team' WHERE role IN ('editor', 'viewer');

-- Step 4: Add new check constraint for valid role values
ALTER TABLE user_clients ADD CONSTRAINT user_clients_role_check
  CHECK (role IN ('brand_owner', 'brand_team'));

-- Step 4: Ensure efficient lookup index
CREATE INDEX IF NOT EXISTS idx_user_clients_user_client
  ON user_clients(user_id, client_id);
