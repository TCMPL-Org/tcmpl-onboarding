# Run order
**Local Run -> GitHub Setup -> Push Changes -> Supabase -> Docker -> Azure**

Each script starts from its own directory, validates prerequisites, stops on failed validation, and displays PASS/FAIL. Login/consent and required cloud identifiers/secrets are requested only by the relevant official CLI flow.

- Local Run: Node 20+, clean install, lint, typecheck, tests, build, preview startup, 10 health/site attempts, then browser. Rollback: close Node process and remove `.env` if disposable.
- GitHub Setup: Git + `gh`; validates before repository creation/push. Asks repository name and visibility. Rollback: remove remote repo if created in error.
- Push Changes: validates before commit/push; asks commit message; displays recent workflows when GitHub CLI is available.
- Supabase: official Supabase CLI login, existing/new project, link and migrations/RLS. Asks only project/auth-required values. Rollback database changes through a reviewed reverse migration.
- Docker: Docker engine check, image build, container startup and `/health`. Rollback: `docker compose down`.
- Azure: official `az login`, subscription, resource/app/location; creates RG, ACR, App Service plan/app, sets port/Always On, deploys and health checks. Rollback: delete only the created resource group if it contains no needed shared resources.
- Complete Validation: clean install, lint, typecheck, tests, build.
