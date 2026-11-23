import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { BusinessProvider } from "@/contexts/BusinessContext";
import { RolesProvider } from "@/contexts/RolesContext";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  GuestOnly,
  RequireAuth,
  RequireBusiness,
  RequireFeature,
  RequireNoBusiness,
  RequireOwner,
  RequireRole,
} from "@/components/layout/Guards";
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
import CalculatorsPage from "@/features/calculators/CalculatorsPage";
import TeamPage from "@/features/team/TeamPage";
import InvitePage from "@/features/team/InvitePage";
import StartPage from "@/features/account/StartPage";
import AccountPage from "@/features/account/AccountPage";
import AdminPage from "@/features/admin/AdminPage";
import ClientPage from "@/features/client/ClientPage";
import SearchPage from "@/features/marketplace/SearchPage";
import { PrivacyPage, TermsPage } from "@/features/legal/LegalPages";
import { TermsGate } from "@/features/legal/TermsGate";
import ProviderPage from "@/features/marketplace/ProviderPage";
import OpportunitiesPage from "@/features/marketplace/OpportunitiesPage";
import ListingPage from "@/features/client/ListingPage";
import PayPage from "@/features/client/PayPage";
import ClientHome from "@/features/client/ClientHome";
import ClientOrdersPage from "@/features/client/ClientOrdersPage";
import PlanPage from "@/features/plan/PlanPage";
import CourierPage from "@/features/courier/CourierPage";
import LandingPage from "@/features/landing/LandingPage";
import { ClientMessagesPage, ProviderMessagesPage } from "@/features/chat/ChatPages";
import AgendaPage from "@/features/agenda/AgendaPage";
import ReviewsPage from "@/features/reviews/ReviewsPage";
import NotFound from "@/pages/NotFound";
import SetupRequired from "@/pages/SetupRequired";

export default function App() {
  if (!supabaseConfigured) return <SetupRequired />;

  return (
    <BrowserRouter>
      <AuthProvider>
        <BusinessProvider>
          <RolesProvider>
            <TermsGate />
            <Routes>
              <Route path="/termos" element={<TermsPage />} />
              <Route path="/privacidade" element={<PrivacyPage />} />
              <Route path="/" element={<LandingPage />} />

              <Route
                path="/login"
                element={
                  <GuestOnly>
                    <LoginPage />
                  </GuestOnly>
                }
              />
              <Route
                path="/cadastro"
                element={
                  <GuestOnly>
                    <SignupPage />
                  </GuestOnly>
                }
              />
              <Route
                path="/recuperar-senha"
                element={
                  <GuestOnly>
                    <ForgotPasswordPage />
                  </GuestOnly>
                }
              />
              <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
              <Route path="/convite/:token" element={<InvitePage />} />
              <Route
                path="/comecar"
                element={
                  <RequireAuth>
                    <StartPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/conta"
                element={
                  <RequireAuth>
                    <AccountPage />
                  </RequireAuth>
                }
              />
              <Route path="/buscar" element={<SearchPage />} />
              <Route path="/p/:slug" element={<ProviderPage />} />
              <Route path="/entregas" element={<RequireAuth><CourierPage /></RequireAuth>} />
              <Route path="/cliente/pagar/:id" element={<RequireAuth><RequireRole role="anunciante"><PayPage /></RequireRole></RequireAuth>} />
              <Route path="/cliente/anuncios/:id" element={<RequireAuth><RequireRole role="anunciante"><ListingPage /></RequireRole></RequireAuth>} />
              <Route path="/cliente" element={<RequireAuth><RequireRole role="anunciante"><ClientHome /></RequireRole></RequireAuth>} />
              <Route path="/cliente/pedidos" element={<RequireAuth><RequireRole role="anunciante"><ClientOrdersPage /></RequireRole></RequireAuth>} />
              <Route path="/cliente/conta" element={<RequireAuth><RequireRole role="anunciante"><ClientPage /></RequireRole></RequireAuth>} />
              <Route path="/cliente/mensagens" element={<RequireAuth><RequireRole role="anunciante"><ClientMessagesPage /></RequireRole></RequireAuth>} />
              <Route path="/cliente/mensagens/:id" element={<RequireAuth><RequireRole role="anunciante"><ClientMessagesPage /></RequireRole></RequireAuth>} />
              <Route
                path="/admin"
                element={
                  <RequireAuth>
                    <RequireRole role="admin">
                      <AdminPage />
                    </RequireRole>
                  </RequireAuth>
                }
              />

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
                <Route path="oportunidades" element={<RequireOwner><OpportunitiesPage /></RequireOwner>} />
                <Route path="mensagens" element={<ProviderMessagesPage />} />
                <Route path="mensagens/:id" element={<ProviderMessagesPage />} />
                <Route path="agenda" element={<AgendaPage />} />
                <Route path="avaliacoes" element={<ReviewsPage />} />
                <Route
                  path="pedidos"
                  element={
                    <RequireFeature code="pedidos">
                      <OrdersPage />
                    </RequireFeature>
                  }
                />
                <Route
                  path="pedidos/novo"
                  element={
                    <RequireFeature code="pedidos">
                      <NewOrderPage />
                    </RequireFeature>
                  }
                />
                <Route
                  path="pedidos/:id"
                  element={
                    <RequireFeature code="pedidos">
                      <OrderDetailPage />
                    </RequireFeature>
                  }
                />
                <Route
                  path="rotas"
                  element={
                    <RequireFeature code="entregas">
                      <RoutesPage />
                    </RequireFeature>
                  }
                />
                <Route
                  path="calculadoras"
                  element={
                    <RequireFeature code="calculadoras">
                      <CalculatorsPage />
                    </RequireFeature>
                  }
                />
                <Route
                  path="equipe"
                  element={
                    <RequireOwner>
                      <RequireFeature code="equipe">
                        <TeamPage />
                      </RequireFeature>
                    </RequireOwner>
                  }
                />
                <Route
                  path="clientes"
                  element={
                    <RequireFeature code="clientes">
                      <CustomersPage />
                    </RequireFeature>
                  }
                />
                <Route
                  path="servicos"
                  element={
                    <RequireFeature code="servicos">
                      <ServicesPage />
                    </RequireFeature>
                  }
                />
                <Route path="configuracoes" element={<SettingsPage />} />
                <Route
                  path="plano"
                  element={
                    <RequireOwner>
                      <PlanPage />
                    </RequireOwner>
                  }
                />
              </Route>

              {/* /:slug (página pública) e /rastrear/:token chegam na Etapa 6 */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </RolesProvider>
        </BusinessProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
