import { configureStore } from '@reduxjs/toolkit';
import { api } from './api';
import uiReducer from './uiSlice';

// A factory so every test can start from a fresh store; the app uses the single `store` below.
export function makeStore() {
  return configureStore({
    reducer: { [api.reducerPath]: api.reducer, ui: uiReducer },
    middleware: (getDefault) => getDefault().concat(api.middleware),
  });
}

export const store = makeStore();

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
