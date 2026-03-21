import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// localStorage stub — jsdom's localStorage is a plain empty object with no
// Storage methods. Replace it with a minimal in-memory implementation so
// tests can call getItem / setItem / removeItem / clear without errors.
// The store is replaced on every module load; individual test files that
// need isolation should call localStorage.clear() in their own beforeEach.
// ---------------------------------------------------------------------------
const localStorageStore = {};
const localStorageMock = {
  getItem: (key) => Object.prototype.hasOwnProperty.call(localStorageStore, key)
    ? localStorageStore[key]
    : null,
  setItem: (key, value) => { localStorageStore[key] = String(value); },
  removeItem: (key) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});
