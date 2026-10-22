'use client';

import { createContext, useContext, useReducer, useEffect, useState, ReactNode } from 'react';

export interface CartItem {
  id: string;
  name: string;
  price: number;
  stock: number;
  unit: string;
  category: string;
  imageUrl: string | null;
  sku: string;
  qty: number;
}

type CartState = CartItem[];

type CartAction =
  | { type: 'ADD_ITEM'; payload: CartItem }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'UPDATE_QTY'; payload: { sku: string; qty: number } }
  | { type: 'CLEAR' }
  | { type: 'HYDRATE'; payload: CartItem[] };

const CART_STORAGE_KEY = 'warung-cart-v2';

function loadInitialState(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

function cartReducer(state: CartItem[], action: any): CartItem[] {
  switch (action.type) {
    case 'HYDRATE':
      return action.payload;

    case 'ADD_ITEM': {
      const existingIndex = state.findIndex((item) => item.sku === action.payload.sku);
      if (existingIndex >= 0) {
        const newItems = [...state];
        const newQty = Math.min(
          newItems[existingIndex].qty + action.payload.qty,
          newItems[existingIndex].stock
        );
        newItems[existingIndex] = { ...newItems[existingIndex], qty: newQty };
        return newItems;
      }
      return [...state, action.payload];
    }

    case 'REMOVE_ITEM':
      return state.filter((item) => item.sku !== action.payload);

    case 'UPDATE_QTY': {
      if (action.payload.qty <= 0) {
        return state.filter((item) => item.sku !== action.payload.sku);
      }
      return state.map((item) =>
        item.sku === action.payload.sku
          ? { ...item, qty: Math.min(action.payload.qty, item.stock) }
          : item
      );
    }

    case 'CLEAR':
      return [];

    default:
      return state;
  }
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'qty'> & { qty?: number }) => void;
  removeItem: (sku: string) => void;
  updateQty: (sku: string, qty: number) => void;
  clearCart: () => void;
  itemCount: number;
  subtotal: number;
  isEmpty: boolean;
  isHydrated: boolean;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, dispatch] = useReducer(cartReducer, []);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const stored = loadInitialState();
    if (stored.length > 0) {
      dispatch({ type: 'HYDRATE', payload: stored });
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    }
  }, [items, isHydrated]);

  const addItem = (item: Omit<CartItem, 'qty'> & { qty?: number }) => {
    dispatch({ type: 'ADD_ITEM', payload: { ...item, qty: item.qty ?? 1 } });
  };

  const removeItem = (sku: string) => {
    dispatch({ type: 'REMOVE_ITEM', payload: sku });
  };

  const updateQty = (sku: string, qty: number) => {
    dispatch({ type: 'UPDATE_QTY', payload: { sku, qty } });
  };

  const clearCart = () => {
    dispatch({ type: 'CLEAR' });
  };

  const itemCount = items.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = items.reduce((sum, item) => sum + Number(item.price) * item.qty, 0);
  const isEmpty = items.length === 0;

  const value = {
    items,
    addItem,
    removeItem,
    updateQty,
    clearCart,
    itemCount,
    subtotal,
    isEmpty,
    isHydrated,
  };

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}