import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { BusinessProvider } from "@/contexts/BusinessContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { GuestOnly, RequireAuth, RequireBusiness, RequireNoBusiness, RequireOwner } from "@/components/layout/Guards";
import { supabaseConfigured } from "@/lib/supabase";
import LoginPage from "@/features/auth/LoginPage";
import SignupPage from "@/features/auth/SignupPage";
import ForgotPasswordPage from "@/features/auth/ForgotPasswordPage";
import ResetPasswordPage from "@/features/auth/ResetPasswordPage";
import OnboardingWizard from "@/features/onboarding/OnboardingWizard";
import DashboardPage from "@/features/dashboard/DashboardPage";
import SettingsPage from "@/features/settings/SettingsPage";
import CustomersPage from "@/features/customers/CustomersPage";
import ServicesPage from "@/features/services/ServicesPage";
import OrdersPage from "@/features/orders/OrdersPage";
import NewOrderPage from "@/features/orders/NewOrderPage";
import OrderDetailPage from "@/features/orders/OrderDetailPage";
import RoutesPage from "@/features/routes/RoutesPage";
import NotFound from "@/pages/NotFound";
import SetupRequired from "@/pages/SetupRequired";

export default function App() {
  if (!supabaseConfigured) return <SetupRequired />;

  return (
    <BrowserRouter>
      <AuthProvider>
        <BusinessProvider>
          <Routes>
            {/* A página institucional da plataforma entra em fase futura */}
            <Route path="/" element={<Navigate to="/app" replace />} />

            <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
            <Route path="/cadastro" element={<GuestOnly><SignupPage /></GuestOnly>} />
            <Route path="/recuperar-senha" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
            <Route path="/redefinir-senha" element={<ResetPasswordPage />} />

            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <RequireNoBusiness>
                    <OnboardingWizard mode="criar" />
                  </RequireNoBusiness>
                </RequireAuth>
              }
            />

            <Route
              path="/personalizar"
              element={
                <RequireAuth>
                  <RequireBusiness>
                    <RequireOwner>
                      <OnboardingWizard mode="personalizar" />
                    </RequireOwner>
                  </RequireBusiness>
                </RequireAuth>
              }
            />

            <Route
              path="/app"
              element={
                <RequireAuth>
                  <RequireBusiness>
                    <AppLayout />
                  </RequireBusiness>
                </RequireAuth>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="pedidos" element={<OrdersPage />} />
              <Route path="pedidos/novo" element={<NewOrderPage />} />
              <Route path="pedidos/:id" element={<OrderDetailPage />} />
              <Route path="rotas" element={<RoutesPage />} />
              <Route path="clientes" element={<CustomersPage />} />
              <Route path="servicos" element={<ServicesPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
            </Route>

            {/* /:slug (página pública) e /rastrear/:token chegam na Etapa 6 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BusinessProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
