import { render } from 'preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { initI18n } from './lib/i18n';
import { registerNodeWardenServiceWorker } from './lib/pwa';
import './tailwind.css';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const root = document.getElementById('root')!;
root.setAttribute('translate', 'no');

function renderApp(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
    root
  );
}

void initI18n()
  .catch((error) => {
    // A failed locale load must not become an unhandled rejection; the app still
    // renders with the built-in (English) defaults.
    console.error('i18n initialization failed; continuing with defaults', error);
  })
  .finally(() => {
    renderApp();
    registerNodeWardenServiceWorker();
  });
