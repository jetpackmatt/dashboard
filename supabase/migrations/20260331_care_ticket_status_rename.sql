-- Rename "Credit Denied" to "Credit Not Approved" and add "Closed" status
-- "Closed" is for negative-resolution tickets, closed during invoice approval cycle

-- Step 1: Drop the old constraint
ALTER TABLE care_tickets DROP CONSTRAINT IF EXISTS care_tickets_status_check;

-- Step 2: Update existing "Credit Denied" records
UPDATE care_tickets SET status = 'Credit Not Approved' WHERE status = 'Credit Denied';

-- Step 3: Add the new constraint with updated values
ALTER TABLE care_tickets ADD CONSTRAINT care_tickets_status_check
  CHECK (status = ANY (ARRAY[
    'Ticket Created'::text,
    'Input Required'::text,
    'Under Review'::text,
    'In Process'::text,
    'Credit Requested'::text,
    'Credit Approved'::text,
    'Credit Not Approved'::text,
    'Closed'::text,
    'Resolved'::text,
    'Deleted'::text
  ]));
