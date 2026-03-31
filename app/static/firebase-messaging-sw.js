/**
 * Service worker for Firebase Cloud Messaging (FCM).
 * Handles background push and notification click → open app with check-in URL.
 */
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "medlive-488722.firebaseapp.com",
  projectId: "medlive-488722",
  storageBucket: "medlive-488722.firebasestorage.app",
  messagingSenderId: "479757625763",
  appId: "1:479757625763:web:61c5299bf510e2b3c3d216",
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "MedLive";
  const options = {
    body: payload.notification?.body || "Tap to open.",
    icon: "/static/img/avatar_placeholder.png",
    data: payload.data || {},
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.indexOf(self.location.origin) === 0 && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
