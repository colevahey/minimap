import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@coinbase/cds-web/system';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { initMapMode } from './map/mapMode';
import { ArModeController } from './ar/arMode';
import { App } from './ui/App';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element missing');

const mapContainer = document.createElement('div');
mapContainer.id = 'map-root';
mapContainer.style.position = 'absolute';
mapContainer.style.inset = '0';
root.appendChild(mapContainer);
const controller = initMapMode(mapContainer);

const arContainer = document.createElement('div');
arContainer.id = 'ar-root';
arContainer.style.position = 'absolute';
arContainer.style.inset = '0';
arContainer.style.display = 'none';
const video = document.createElement('video');
video.autoplay = true;
video.playsInline = true;
video.muted = true;
video.style.width = '100%';
video.style.height = '100%';
video.style.objectFit = 'cover';
video.style.backgroundColor = '#000';
const canvas = document.createElement('canvas');
canvas.style.position = 'absolute';
canvas.style.inset = '0';
canvas.style.width = '100%';
canvas.style.height = '100%';
arContainer.appendChild(video);
arContainer.appendChild(canvas);
root.appendChild(arContainer);
const arController = new ArModeController(video, canvas, controller);

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
      <App controller={controller} arController={arController} mapContainer={mapContainer} arContainer={arContainer} />
    </ThemeProvider>
  </StrictMode>,
);
