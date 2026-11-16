// The part of Firebase Authentication that the menu, the roles and the fetch helper use. Only session.js imports it, and always
// dynamically: this file (with the SDK) is not part of the page every visitor downloads first.
export { auth } from './auth'
export { onAuthStateChanged, signOut } from 'firebase/auth'
