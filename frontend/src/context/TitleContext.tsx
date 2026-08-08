import { createContext, useContext, useState, ReactNode } from 'react';

interface TitleContextType {
  baseTitle: string;
  setBaseTitle: (title: string) => void;
}

const TitleContext = createContext<TitleContextType | undefined>(undefined);

export function TitleProvider({ children }: { children: ReactNode }) {
  const [baseTitle, setBaseTitle] = useState('Sigma AI');

  return (
    <TitleContext.Provider value={{ baseTitle, setBaseTitle }}>
      {children}
    </TitleContext.Provider>
  );
}

export function useTitle() {
  const context = useContext(TitleContext);
  if (!context) throw new Error("useTitle must be used within TitleProvider");
  return context;
}
