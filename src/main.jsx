import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import preservedMarkup from './preserved.html?raw';
import './styles.css';
import './azure-bridge.js';

function PreservedApplication() {
  useLayoutEffect(() => {
    import('./legacy-app.js').then(() => import('./wa-inbox.js')).then(() => import('./journey-live.js')).then(() => import('./forms-live.js')).then(() => import('./induction-live.js')).then(() => import('./hr-live.js')).then(() => import('./settings-live.js')).then(() => import('./checkins-live.js')).then(() => import('./module-switch.js'));
  }, []);
  return React.createElement('div', {
    id: 'tcmpl-preserved-app',
    dangerouslySetInnerHTML: { __html: preservedMarkup }
  });
}

createRoot(document.getElementById('root')).render(React.createElement(PreservedApplication));
