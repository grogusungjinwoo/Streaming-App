/// <reference types="vite/client" />

interface Window {
  streamingApp?: {
    isDesktop: boolean;
    exportMp4: (payload: {
      data: ArrayBuffer;
      inputExtension: string;
      suggestedName: string;
    }) => Promise<{
      canceled: boolean;
      filePath?: string;
      error?: string;
    }>;
  };
}
