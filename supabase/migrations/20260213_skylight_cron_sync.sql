-- Automatic Skylight sync: runs every hour from 8am to 10pm Eastern Time
-- Uses pg_cron + pg_net to call the sync-from-skylight edge function
--
-- To apply: Run this SQL in the Supabase SQL Editor (Dashboard > SQL Editor)
-- To verify: SELECT * FROM cron.job WHERE jobname = 'skylight-sync-hourly';
-- To check run history: SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'skylight-sync-hourly') ORDER BY start_time DESC LIMIT 10;
-- To disable: SELECT cron.unschedule('skylight-sync-hourly');

-- Enable extensions (already enabled on most Supabase projects)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing skylight sync jobs (idempotent re-runs)
DO $$
BEGIN
    PERFORM cron.unschedule('skylight-sync-hourly');
EXCEPTION WHEN OTHERS THEN
    -- Job doesn't exist yet, that's fine
    NULL;
END $$;

-- Schedule hourly sync from 8am to 10pm Eastern Time
-- pg_cron on Supabase runs in UTC. To cover both EST (UTC-5) and EDT (UTC-4):
--   8am ET = 12pm or 1pm UTC
--   10pm ET = 2am or 3am UTC
-- Schedule: UTC hours 12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3
-- This is a superset that ensures 8am-10pm ET coverage year-round.
-- The sync is lightweight (no-op when nothing changed), so extra runs are fine.
SELECT cron.schedule(
    'skylight-sync-hourly',
    '0 0,1,2,3,12,13,14,15,16,17,18,19,20,21,22,23 * * *',
    $$
    SELECT net.http_post(
        url := 'https://ilinxxocqvgncglwbvom.supabase.co/functions/v1/sync-from-skylight',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsaW54eG9jcXZnbmNnbHdidm9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2MTExMTQsImV4cCI6MjA4NTE4NzExNH0.qZYyCnaXXMUnbFOWmkUZRhIyGfdzXHwfBbJc86hKEHA'
        ),
        body := '{}'::jsonb
    );
    $$
);
