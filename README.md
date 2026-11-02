# TCMPL AI Onboarding Agent

Offer to Day 90 onboarding agent for TCMPL HR Shared Services.
Hosted on **Azure Static Web Apps**, deployed automatically from this private GitHub repo.

## Run it on your PC

```
cd C:\dev\tcmpl-react
npm install
npm run dev
```

Open http://localhost:3000. Or double-click `run_scripts\01-local-run.bat`.

## Check before every push

```
npm run check
```

Runs lint, type check, tests and the production build. Push only if it passes.

## Publish a change

```
git add -A
git commit -m "what changed"
git push
```

Azure rebuilds and updates the live site in about 2 minutes. Watch progress in the GitHub **Actions** tab.

## How it is hosted

| Part | Where |
|---|---|
| Code | This private GitHub repo |
| Live site + Microsoft login | Azure Static Web App, resource group `tcmpl-onboarding-rg` |
| Build settings | App location `/`, API location empty (later `api`), output `dist` |
| Login rules | `public/staticwebapp.config.json` |

## Project layout

| Path | What it is |
|---|---|
| `src/preserved.html` | The app's screens (all 7 tabs) |
| `src/legacy-app.js` | The app's logic (salary engine, agent, forms, readiness) |
| `src/styles.css` | The app's design |
| `src/main.jsx` | Starts the app |
| `public/staticwebapp.config.json` | Login and routing rules for Azure |
| `tests/` | Automated checks |
| `.github/workflows/ci-cd.yml` | Runs `npm run check` on every push |

## Scripts

| Script | Use? |
|---|---|
| `01-local-run.bat` | Yes: run locally |
| `02-github-setup.bat` | Optional: choose **private** |
| `03-push-changes.bat` | Yes: check and push |
| `07-complete-validation.bat` | Yes: full check |
| `04-supabase-setup.bat`, `05-docker-run.bat`, `06-azure-deploy.bat` | No: not used in the Static Web Apps setup |

## Security

- Never commit passwords, keys or connection strings. They go only into the Azure Static Web App's environment variables.
- Never put candidate or client data in this repo.
- Keep the repo private.
