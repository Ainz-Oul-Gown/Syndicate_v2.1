import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import NotificationViewport from './components/NotificationViewport';
import { installAlertNotificationBridge } from './lib/notifications';
import NetworkStatus from './components/NetworkStatus';
import PwaUpdatePrompt from './components/PwaUpdatePrompt';

installAlertNotificationBridge();


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <NetworkStatus />
    <PwaUpdatePrompt />
    <NotificationViewport />
  </StrictMode>,
);
