import { App } from './app';

const canvas = document.getElementById('game');
if (canvas instanceof HTMLCanvasElement) new App(canvas);
