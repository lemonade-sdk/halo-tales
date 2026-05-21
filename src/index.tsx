import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installGlobalErrorLogging, log } from './util/logger';
import './styles/global.css';

installGlobalErrorLogging();
log.info('renderer booted');

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
