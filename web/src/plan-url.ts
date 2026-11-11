// The review book is published from the external design workspace.
export const planUrl = import.meta.env.VITE_EMBEDDED_PLAN
  ? "/plan/"
  : "https://familiar-two.vercel.app/plan/";
