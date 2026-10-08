import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lucrum.mobile',
  appName: 'Lucrum',
  webDir: '../web/dist',
  // The WebView loads the built PWA from the app bundle over a custom https scheme.
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      launchAutoHide: true,
      showSpinner: false,
      backgroundColor: '#020617',
      androidSplashResourceName: 'splash',
    },
  },
};

export default config;
