import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import App from './App';
import { AuthBoundary } from './AuthBoundary';
import './styles.css';
import { LanguageProvider } from './i18n';

createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><AuthBoundary><App /></AuthBoundary></LanguageProvider></React.StrictMode>);
