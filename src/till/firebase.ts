import { useEffect, useState } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import catalogue from "./catalogue.json";
import type { Product, Sale } from "./types";

// These settings identify the Firebase project and are meant to be public. What protects the
// data is the sign-in plus the database rules in firestore.rules.
const app = initializeApp({
  apiKey: "AIzaSyDqCCiWPSgfvC9UdziKgGTcRn-PJyihuV8",
  authDomain: "roseberry-till.firebaseapp.com",
  projectId: "roseberry-till",
  storageBucket: "roseberry-till.firebasestorage.app",
  messagingSenderId: "539154952163",
  appId: "1:539154952163:web:2182d1945f3bbf96b7fad6",
});

const auth = getAuth(app);

// Keeps a copy on the iPad, so the till opens with its products even with no internet.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
});

export const signIn = (email: string, password: string) => signInWithEmailAndPassword(auth, email, password);
export const signOutTill = () => signOut(auth);

// undefined while Firebase is still checking the saved sign-in.
export function useUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return user;
}

const products = collection(db, "products");

// Live product list. The first time the database is empty, it is filled from the spreadsheet
// import (catalogue.json). Until the first answer arrives, the bundled list is shown.
export function useProducts(user: User | null | undefined) {
  const [list, setList] = useState<Product[]>(catalogue as Product[]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!user) return;
    return onSnapshot(products, (snap) => {
      if (snap.empty && !snap.metadata.fromCache) {
        const batch = writeBatch(db);
        for (const p of catalogue as Product[]) batch.set(doc(products, p.id), { ...p, updatedAt: serverTimestamp() });
        batch.commit();
        return;
      }
      if (snap.empty) return;
      setList(snap.docs.map((d) => d.data() as Product).sort((a, b) => a.name.localeCompare(b.name)));
      setLoaded(true);
    });
  }, [user]);
  return { products: list, loaded };
}

// Writes go to the iPad first and upload when online, so saving works offline too.
export function saveProduct(p: Product) {
  return setDoc(doc(products, p.id), { ...p, updatedAt: serverTimestamp() });
}

// Sales, one document each. Like products, writes land on the iPad first and upload when online.
const salesCol = collection(db, "sales");

export const putSale = (s: Sale) => setDoc(doc(salesCol, s.id), { ...s, syncedAt: serverTimestamp() });
export const removeSale = (id: string) => deleteDoc(doc(salesCol, id));

// Every till's sales, all time, live.
export function watchSales(onError: (e: Error) => void, onList: (list: Sale[]) => void) {
  return onSnapshot(
    salesCol,
    (snap) =>
      onList(
        snap.docs.map((d) => {
          const { syncedAt: _, ...sale } = d.data();
          return sale as Sale;
        })
      ),
    onError
  );
}

// Shared settings (card fee, front page layout): one document each in "config", under `value`.
export const putConfig = (name: string, value: unknown) => setDoc(doc(db, "config", name), { value, updatedAt: serverTimestamp() });

export function watchConfig<T>(name: string, onError: (e: Error) => void, onValue: (value: T | null) => void) {
  return onSnapshot(
    doc(db, "config", name),
    (snap) => snap.exists() && !snap.metadata.hasPendingWrites && onValue((snap.data().value ?? null) as T | null),
    onError
  );
}
