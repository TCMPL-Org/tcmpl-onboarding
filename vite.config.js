/* global process */
import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react';
// base: '/' for Azure Static Web Apps and local use.
// The GitHub Pages workflow sets PAGES_BASE=/tcmpl-onboarding/ because Pages serves the site under the repo name.
export default defineConfig({base:process.env.PAGES_BASE||'/',plugins:[react()],server:{host:'0.0.0.0'},preview:{host:'0.0.0.0',port:3000}});
