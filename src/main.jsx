import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import preservedMarkup from './preserved.html?raw';
import './styles.css';
import './azure-bridge.js';
import './ctc-engine.js';
import { signInGate } from './login.js';

function PreservedApplication() {
  useLayoutEffect(() => {
    import('./legacy-app.js').then(() => import('./wa-inbox.js')).then(() => import('./journey-live.js')).then(() => import('./forms-live.js')).then(() => import('./induction-live.js')).then(() => import('./hr-live.js')).then(() => import('./settings-live.js')).then(() => import('./checkins-live.js')).then(() => import('./module-switch.js')).then(() => import('./admin-live.js')).then(() => import('./ctc-live.js')).then(() => import('./shell.js'));
  }, []);
  return React.createElement('div', {
    id: 'tcmpl-preserved-app',
    dangerouslySetInnerHTML: { __html: preservedMarkup }
  });
}

// The app loads only for people on the user list; everyone else sees the login (or no-access) page.
signInGate().then(ok => {
  if (ok) createRoot(document.getElementById('root')).render(React.createElement(PreservedApplication));
});
