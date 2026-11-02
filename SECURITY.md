# Security
Never commit `.env`, cloud credentials, Supabase service-role keys, Azure credentials, tokens, or production exports. Public browser code may only use the Supabase anon key with Row Level Security. Keep privileged secrets in GitHub Actions secrets/Azure settings. Deployment automation uses official CLIs and does not bypass endpoint protection or authentication.
