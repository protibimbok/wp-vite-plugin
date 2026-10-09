/** Browser-side helpers. Filled in during later steps. */
export const isDev: boolean = typeof import.meta !== 'undefined' && Boolean((import.meta as { hot?: unknown }).hot);
