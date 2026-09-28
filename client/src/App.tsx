import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { SessionProvider } from '@/contexts/SessionContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { DataStreamProvider } from '@/components/data-stream-provider';
import { Toaster } from 'sonner';
import RootLayout from '@/layouts/RootLayout';
import ChatLayout from '@/layouts/ChatLayout';
import NewChatPage from '@/pages/NewChatPage';
import ChatPage from '@/pages/ChatPage';
import StorefrontPage from '@/pages/StorefrontPage';
import CheckoutAddressPage from '@/pages/CheckoutAddressPage';
import CheckoutPaymentPage from '@/pages/CheckoutPaymentPage';
import OrderDetailPage from '@/pages/OrderDetailPage';
import OrdersListPage from '@/pages/OrdersListPage';

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <SessionProvider>
        <AppConfigProvider>
          <DataStreamProvider>
            <Toaster position="top-center" />
            <Routes>
              <Route path="/" element={<RootLayout />}>
                <Route index element={<StorefrontPage />} />
                <Route path="checkout/address" element={<CheckoutAddressPage />} />
                <Route path="checkout/payment" element={<CheckoutPaymentPage />} />
                <Route path="orders" element={<OrdersListPage />} />
                <Route path="orders/:orderId" element={<OrderDetailPage />} />
                <Route element={<ChatLayout />}>
                  <Route path="assistant" element={<NewChatPage />} />
                  <Route path="assistant/chat/:id" element={<ChatPage />} />
                </Route>
              </Route>
            </Routes>
          </DataStreamProvider>
        </AppConfigProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

export default App;