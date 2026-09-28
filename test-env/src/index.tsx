import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { configureAvatarPresets } from 'gsplat-talkinghead';

// Local dev only: load preset avatars from the package's assets/ folder
// (served by craco.config.js) instead of jsDelivr, which only has
// published versions.
configureAvatarPresets({ baseUrl: '/avatars' });

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
