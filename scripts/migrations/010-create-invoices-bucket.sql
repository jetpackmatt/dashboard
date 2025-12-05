-- Create invoices storage bucket
-- This bucket stores generated PDF and XLS invoice files

-- Create the bucket (will be done via Supabase dashboard or API)
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('invoices', 'invoices', false);

-- Note: Create bucket manually in Supabase Dashboard:
-- Storage > Create new bucket > Name: "invoices" > Private: Yes

-- RLS policies for invoices bucket

-- Allow admins to upload/update/delete files
CREATE POLICY "Admins can manage invoice files"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'invoices' AND
  auth.jwt() ->> 'role' = 'admin'
)
WITH CHECK (
  bucket_id = 'invoices' AND
  auth.jwt() ->> 'role' = 'admin'
);

-- Allow clients to read their own invoice files
-- Files are stored as {client_id}/{invoice_number}.xlsx
CREATE POLICY "Clients can read own invoice files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'invoices' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM clients
    WHERE id IN (
      SELECT client_id FROM user_clients
      WHERE user_id = auth.uid()
    )
  )
);

-- Alternative: Allow service role full access (for cron jobs)
-- This is automatically granted to service_role
