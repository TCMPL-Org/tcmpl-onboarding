import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import preservedMarkup from './preserved.html?raw';
import './styles.css';
import './azure-bridge.js';

function PreservedApplication() {
  useLayoutEffect(() => {
    import('./legacy-app.js');
  }, []);
  return React.createElement('div', {
    id: 'tcmpl-preserved-app',
    dangerouslySetInnerHTML: { __html: preservedMarkup }
  });
}

createRoot(document.getElementById('root')).render(React.createElement(PreservedApplication));
