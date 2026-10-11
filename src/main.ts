import { Host } from './host';

const canvas = document.getElementById('game');
if (canvas instanceof HTMLCanvasElement) new Host(canvas);
