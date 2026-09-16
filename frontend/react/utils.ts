// Magic UI использует cn для объединения CSS-классов; без зависимости от Next.js.
import {clsx, type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
