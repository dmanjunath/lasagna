// Set at build time. Local dev defaults to the Docker API and Vite web app.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000").replace(/\/$/, "");
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || "http://localhost:5173").replace(/\/$/, "");
