// Global type augmentation for Chart.js loaded via CDN
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Chart: any;
  }
}

export {};
