const socket = io();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Keep Render from spinning down during a session (fires every 10 minutes).
setInterval(() => fetch('/ping').catch(() => {}), 10 * 60 * 1000);
