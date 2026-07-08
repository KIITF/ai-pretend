// firebase-config.js (プロジェクトルートに配置)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyA9S9ZHfeZ0MFL32ihEJpndYvZKT_2rfJI",
    authDomain: "ai-pretend.firebaseapp.com",
    databaseURL: "https://ai-pretend-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ai-pretend",
    storageBucket: "ai-pretend.firebasestorage.app",
    messagingSenderId: "248259351182",
    appId: "1:248259351182:web:29b8f3d9a60069a8daefdf",
    measurementId: "G-GD8KLC1VT6"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);