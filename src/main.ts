import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/800.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/unbounded/800.css';
import './styles/main.css';
import './styles/studio.css';

import { App } from './ui/app.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app root element is missing');

void new App(root).boot();
