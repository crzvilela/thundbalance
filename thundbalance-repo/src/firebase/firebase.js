import { initializeApp } from "firebase/app"

const firebaseConfig = {
  apiKey: "AIzaSyDGhV-tA50ANk01W91Wksl1aAkuspXbd_Q",
  authDomain: "thundbalance.firebaseapp.com",
  projectId: "thundbalance",
  storageBucket: "thundbalance.firebasestorage.app",
  messagingSenderId: "594297742677",
  appId: "1:594297742677:web:e4cefbda949d3f8fbefbdc"
}

const app = initializeApp(firebaseConfig)

export default app