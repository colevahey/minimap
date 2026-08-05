import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@coinbase/cds-web/system';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { initMapMode } from './map/mapMode';
import { App } from './ui/App';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element missing');

const mapContainer = document.createElement('div');
mapContainer.id = 'map-root';
mapContainer.style.position = 'absolute';
mapContainer.style.inset = '0';
root.appendChild(mapContainer);
initMapMode(mapContainer);

const uiContainer = document.createElement('div');
uiContainer.id = 'ui-root';
uiContainer.style.position = 'absolute';
uiContainer.style.inset = '0';
uiContainer.style.pointerEvents = 'none';
root.appendChild(uiContainer);

const activeColorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light';

createRoot(uiContainer).render(
  <StrictMode>
    <ThemeProvider theme={defaultTheme} activeColorScheme={activeColorScheme}>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
