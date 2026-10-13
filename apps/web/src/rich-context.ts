import { createContext } from 'react';
export const RichActionContext = createContext<(message: string) => void>(() => {});
