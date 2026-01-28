// Supabase Client for Grocery App
// This is separate from the coffee app's Supabase instance

const SUPABASE_URL = 'https://ilinxxocqvgncglwbvom.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsaW54eG9jcXZnbmNnbHdidm9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2MTExMTQsImV4cCI6MjA4NTE4NzExNH0.qZYyCnaXXMUnbFOWmkUZRhIyGfdzXHwfBbJc86hKEHA';

// Initialize Supabase client
if (typeof supabase !== 'undefined' && supabase.createClient) {
    window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('Grocery app Supabase client initialized');
} else {
    console.error('Supabase library not loaded. Make sure the CDN script is included in index.html');
}
