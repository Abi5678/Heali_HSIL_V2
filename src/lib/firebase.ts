import { initializeApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";

// When VITE_USE_LOCAL_AUTH=true the app runs without Firebase.
// auth and app are null in that mode — AuthContext handles the null check.
const USE_LOCAL_AUTH = import.meta.env.VITE_USE_LOCAL_AUTH === "true";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

if (!USE_LOCAL_AUTH) {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
}

export { auth };
export default app;
