// config.js
export const CONFIG = {
  GAS_URL:
    "https://script.google.com/macros/s/AKfycbwS88JTgj1NVqhGAaMKi3MXxTawF9zA6mkG6avgxmIj8c61_20EjNZdY0_0U6kKor29/exec",
  PUSH_SENDER_URL: "https://taxi-vorbestellungen.vercel.app/api/send",
  PUSH_SENDER_SECRET: "murtal123pushkey",
};
export const API = CONFIG.GAS_URL;
window.GAS_URL = CONFIG.GAS_URL;
window.PUSH_SENDER_URL = CONFIG.PUSH_SENDER_URL;
window.PUSH_SENDER_SECRET = CONFIG.PUSH_SENDER_SECRET;
