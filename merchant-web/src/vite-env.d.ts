/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MENU_API_URL: string;
  readonly VITE_AVAILABILITY_API_URL: string;
  readonly VITE_POS_API_URL: string;
  readonly VITE_DEFAULT_VENUE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
