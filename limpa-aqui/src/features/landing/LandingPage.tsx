import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BedDouble,
  Bike,
  CheckCircle2,
  Footprints,
  MapPin,
  Menu,
  QrCode,
  Search,
  Shirt,
  ShieldCheck,
  Smartphone,
  Sofa,
  Sparkles,
  Store,
  WashingMachine,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react";
import { Logo, buttonClass, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { COMPANY } from "@/lib/legal";

const NAV = [
  ["#inicio", "Início"],
  ["#quem-somos", "Quem somos"],
  ["#servicos", "Serviços"],
  ["#como-funciona", "Como funciona"],
  ["#lavanderias", "Para lavanderias"],
] as const;

const SERVICES: Array<[LucideIcon, string, string]> = [
  [Shirt, "Lavar e passar", "lavagem_roupas"],
  [Wind, "Secagem", "lavagem_roupas"],
  [Sparkles, "Lavagem a seco", "lavagem_roupas"],
  [Footprints, "Tênis", "lavagem_tenis"],
  [Sofa, "Sofás e estofados", "higienizacao_sofas"],
  [BedDouble, "Edredons e cama", "lavagem_roupas"],
];

const STEPS = [
  ["Encontre", "Busque lavanderias e profissionais da sua cidade e compare preços."],
  ["Peça", "Monte o pedido pelo catálogo ou publique um anúncio e receba propostas."],
  ["Coleta (opcional)", "O prestador ou um entregador busca na sua porta, se você quiser."],
  ["Receba", "Acompanhe cada etapa e receba tudo limpo, pagando por Pix ou direto."],
];

/** Bloco ilustrado (no lugar de foto): degradê da marca com um ícone grande. */
function Art({ icon: Icon, className, tone = "agua" }: { icon: LucideIcon; className?: string; tone?: "agua" | "petroleo" | "nevoa" }) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-3xl",
        tone === "agua" && "bg-gradient-to-br from-agua to-[#2FAE9B] text-white",
        tone === "petroleo" && "bg-gradient-to-br from-petroleo-600 to-petroleo text-agua",
        tone === "nevoa" && "bg-gradient-to-br from-agua-50 to-white text-agua-600 ring-1 ring-grafite/5",
        className,
      )}
      aria-hidden
    >
      <span className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
      <span className="absolute -bottom-8 -left-4 h-28 w-28 rounded-full bg-white/10" />
      <Icon className="relative h-1/3 w-1/3" strokeWidth={1.4} />
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-agua-600">{children}</p>;
}

/** / — site institucional do Limpa Aqui: apresentação e aquisição de clientes e prestadores. */
export default function LandingPage() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [cities, setCities] = useState<number | null>(null);

  useEffect(() => {
    document.title = "Limpa Aqui — lavanderias do RJ na palma da mão";
    void supabase.rpc("marketplace_municipalities").then(({ data }) => setCities(Array.isArray(data) ? data.length : null));
  }, []);

  const appLink = session ? "/conta" : "/cadastro";

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-grafite">
      {/* Topo */}
      <header className="sticky top-0 z-30 border-b border-grafite/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="#inicio" aria-label="Limpa Aqui — início">
            <Logo />
          </a>
          <nav className="hidden items-center gap-1 rounded-full border border-grafite/10 px-2 py-1 lg:flex" aria-label="Seções">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} className="rounded-full px-3 py-1.5 text-sm text-grafite-500 transition hover:bg-agua-50 hover:text-petroleo">
                {label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2 sm:flex">
            {session ? (
              <Link to="/conta" className={buttonClass()}>
                Ir para minha conta
              </Link>
            ) : (
              <>
                <Link to="/login" className={cn(buttonClass("outline"), "h-10 rounded-full")}>
                  Entrar
                </Link>
                <Link to="/cadastro" className={cn(buttonClass(), "h-10 rounded-full")}>
                  Criar conta
                </Link>
              </>
            )}
          </div>
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl text-petroleo lg:hidden sm:ml-0" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <nav className="border-t border-grafite/5 bg-white px-4 py-3 lg:hidden" aria-label="Seções" data-testid="landing-mobile-menu">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-grafite hover:bg-nevoa">
                {label}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:hidden">
              {session ? (
                <Link to="/conta" className={cn(buttonClass(), "col-span-2")}>
                  Ir para minha conta
                </Link>
              ) : (
                <>
                  <Link to="/login" className={buttonClass("outline")}>
                    Entrar
                  </Link>
                  <Link to="/cadastro" className={buttonClass()}>
                    Criar conta
                  </Link>
                </>
              )}
            </div>
          </nav>
        )}
      </header>

      <main>
        {/* Capa */}
        <section id="inicio" className="relative scroll-mt-16">
          <div className="pointer-events-none absolute -left-24 top-10 h-64 w-64 rounded-full bg-agua-50" aria-hidden />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-24">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-agua-50 px-3 py-1 text-xs font-semibold text-petroleo">
                <MapPin className="h-3.5 w-3.5" aria-hidden /> Estado do Rio de Janeiro
              </span>
              <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-petroleo sm:text-5xl">
                Lavanderia boa,
                <br />
                <span className="text-agua-600">na sua porta.</span>
              </h1>
              <p className="mt-4 max-w-md text-base text-grafite-500">
                Encontre lavanderias e profissionais perto de você, compare preços, peça com coleta e entrega e acompanhe tudo pelo celular.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/buscar" className={cn(buttonClass(), "h-12 rounded-full px-6")} data-testid="cta-buscar">
                  <Search className="h-4 w-4" aria-hidden /> Encontrar lavanderia
                </Link>
                <a href="#lavanderias" className={cn(buttonClass("outline"), "h-12 rounded-full px-6")}>
                  Tenho uma lavanderia
                </a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-grafite-500">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-agua-600" aria-hidden /> Pix pelo app ou direto
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-agua-600" aria-hidden /> Coleta opcional
                </li>
                {cities ? (
                  <li className="flex items-center gap-1.5" data-testid="cities-count">
                    <CheckCircle2 className="h-4 w-4 text-agua-600" aria-hidden /> Atendendo em {cities} {cities === 1 ? "município" : "municípios"}
                  </li>
                ) : null}
              </ul>
            </div>
            {/* Colagem */}
            <div className="relative mx-auto h-[340px] w-full max-w-md sm:h-[420px]" data-testid="hero-collage">
              <div className="absolute right-0 top-0 h-[46%] w-[62%]"><Art icon={Shirt} tone="nevoa" className="h-full w-full" /></div>
              <div className="absolute left-0 top-[26%] z-10 h-[50%] w-[64%] rounded-3xl ring-8 ring-white"><Art icon={WashingMachine} tone="agua" className="h-full w-full" /></div>
              <div className="absolute bottom-0 right-0 h-[46%] w-[44%]"><Art icon={Sparkles} tone="petroleo" className="h-full w-full" /></div>
              <div className="absolute bottom-2 left-4 z-20 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-lg">
                <CheckCircle2 className="h-5 w-5 text-agua-600" aria-hidden />
                <div>
                  <p className="text-xs font-semibold text-petroleo">Pedido pronto!</p>
                  <p className="text-[10px] text-grafite-500">Saiu para entrega</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Quem somos */}
        <section id="quem-somos" className="scroll-mt-16 bg-nevoa/60">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
            <div className="relative order-2 lg:order-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-3xl bg-white p-6 shadow-sm">
                  <Search className="h-6 w-6 text-agua-600" aria-hidden />
                  <p className="mt-3 text-sm font-semibold text-petroleo">Busca por cidade</p>
                  <p className="mt-1 text-xs text-grafite-500">Só aparece quem atende de verdade a sua região.</p>
                </div>
                <div className="mt-8 rounded-3xl bg-petroleo p-6 text-white shadow-sm">
                  <QrCode className="h-6 w-6 text-agua" aria-hidden />
                  <p className="mt-3 text-sm font-semibold">Pagamento seguro</p>
                  <p className="mt-1 text-xs text-white/60">Pix pelo app, com devolução se o pedido for cancelado.</p>
                </div>
                <div className="rounded-3xl bg-white p-6 shadow-sm">
                  <Bike className="h-6 w-6 text-agua-600" aria-hidden />
                  <p className="mt-3 text-sm font-semibold text-petroleo">Coleta e entrega</p>
                  <p className="mt-1 text-xs text-grafite-500">Pelo prestador ou por entregadores aprovados.</p>
                </div>
                <div className="mt-8 rounded-3xl bg-white p-6 shadow-sm">
                  <ShieldCheck className="h-6 w-6 text-agua-600" aria-hidden />
                  <p className="mt-3 text-sm font-semibold text-petroleo">Tudo registrado</p>
                  <p className="mt-1 text-xs text-grafite-500">Pedido, status e pagamento acompanhados passo a passo.</p>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <Eyebrow>Quem somos</Eyebrow>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-petroleo">
                O jeito simples de cuidar
                <br />
                das suas roupas.
              </h2>
              <p className="mt-4 text-grafite-500">
                O Limpa Aqui conecta quem precisa lavar com lavanderias, autônomos e entregadores do estado do Rio de Janeiro. Você escolhe o
                serviço, a forma de pagamento e se quer coleta: o resto a gente organiza.
              </p>
              <Link to="/buscar" className={cn(buttonClass("dark"), "mt-6 rounded-full")}>
                Ver lavanderias perto de mim <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        {/* Serviços */}
        <section id="servicos" className="scroll-mt-16">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
            <div>
              <Eyebrow>Serviços</Eyebrow>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-petroleo">
                Tudo o que precisa
                <br />
                de uma boa lavagem.
              </h2>
              <p className="mt-4 text-grafite-500">
                Roupas do dia a dia, peças delicadas, tênis, edredons e estofados. Cada prestador mostra os próprios preços: você vê o total antes de
                pedir.
              </p>
              <Link to="/buscar" className={cn(buttonClass(), "mt-6 rounded-full")}>
                Buscar serviços
              </Link>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="landing-services">
              {SERVICES.map(([Icon, label, cat]) => (
                <li key={label}>
                  <Link
                    to={`/buscar?c=${cat}`}
                    className="flex flex-col items-center gap-3 rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-grafite/5 transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-agua-50 text-agua-600">
                      <Icon className="h-6 w-6" aria-hidden />
                    </span>
                    <span className="text-sm font-semibold text-petroleo">{label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="scroll-mt-16 bg-nevoa/60">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
            <Art icon={WashingMachine} tone="petroleo" className="h-64 sm:h-80" />
            <div>
              <Eyebrow>Em 4 passos</Eyebrow>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-petroleo">Como funciona</h2>
              <ol className="mt-6 space-y-4" data-testid="landing-steps">
                {STEPS.map(([title, text], i) => (
                  <li key={title} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-agua bg-white text-sm font-bold text-petroleo">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p className="font-semibold text-petroleo">{title}</p>
                      <p className="text-sm text-grafite-500">{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Para lavanderias + app */}
        <section id="lavanderias" className="scroll-mt-16">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
            <div>
              <Eyebrow>Para lavanderias e autônomos</Eyebrow>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-petroleo">
                Mais clientes e a gestão
                <br />
                da lavanderia num só app.
              </h2>
              <ul className="mt-5 space-y-2.5 text-sm text-grafite">
                {[
                  "Apareça na busca da sua cidade e receba pedidos e propostas",
                  "Pedidos, clientes, rotas de entrega e calculadoras de preço",
                  "Receba por Pix pelo app, com repasse, ou direto do cliente",
                  "Comece grátis: sem mensalidade obrigatória",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-agua-600" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to={appLink} className={cn(buttonClass("dark"), "h-12 rounded-full px-6")} data-testid="cta-prestador">
                  <Store className="h-4 w-4" aria-hidden /> {session ? "Ir para minha conta" : "Cadastrar minha lavanderia"}
                </Link>
                {!session && (
                  <Link to="/cadastro" className={cn(buttonClass("outline"), "h-12 rounded-full px-6")}>
                    <Bike className="h-4 w-4" aria-hidden /> Quero fazer entregas
                  </Link>
                )}
              </div>
              <p className="mt-4 flex items-center gap-1.5 text-xs text-grafite-500">
                <Smartphone className="h-4 w-4" aria-hidden /> Funciona no navegador do celular e do computador, sem instalar nada.
              </p>
            </div>
            {/* Celular ilustrativo */}
            <div className="relative mx-auto flex h-[420px] w-full max-w-sm items-center justify-center">
              <span className="absolute h-72 w-72 rounded-full bg-agua sm:h-80 sm:w-80" aria-hidden />
              <div className="relative w-56 rounded-[2.2rem] border-[6px] border-petroleo bg-white p-3 shadow-2xl" aria-hidden>
                <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-grafite/15" />
                <div className="rounded-2xl bg-gradient-to-br from-agua to-[#2FAE9B] p-3 text-white">
                  <p className="text-[10px] text-white/80">Olá!</p>
                  <p className="text-xs font-semibold">Seu pedido está em lavagem</p>
                  <div className="mt-2 h-1 rounded-full bg-white/30">
                    <div className="h-1 w-2/3 rounded-full bg-white" />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[Shirt, Footprints, Sofa, BedDouble].map((I, i) => (
                    <div key={i} className="flex h-16 items-center justify-center rounded-xl bg-agua-50 text-agua-600">
                      <I className="h-6 w-6" />
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-xl bg-petroleo py-2 text-center text-[11px] font-semibold text-white">Fazer pedido</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Rodapé */}
      <footer className="bg-[#EEF3F4]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-3 text-sm text-grafite-500">Marketplace de lavanderias, gestão e logística no estado do Rio de Janeiro.</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-petroleo">Menu</p>
            <ul className="mt-3 space-y-2 text-sm text-grafite-500">
              {NAV.map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="hover:text-petroleo">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-petroleo">Links úteis</p>
            <ul className="mt-3 space-y-2 text-sm text-grafite-500">
              <li>
                <Link to="/buscar" className="hover:text-petroleo">
                  Buscar lavanderias
                </Link>
              </li>
              <li>
                <Link to="/termos" className="hover:text-petroleo">
                  Termos de Uso
                </Link>
              </li>
              <li>
                <Link to="/privacidade" className="hover:text-petroleo">
                  Política de Privacidade
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-petroleo">
                  Entrar
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-petroleo">Empresa</p>
            <ul className="mt-3 space-y-2 text-sm text-grafite-500">
              <li>{COMPANY.legalName}</li>
              <li>CNPJ {COMPANY.document}</li>
              <li>{COMPANY.forum}</li>
              {COMPANY.email && (
                <li>
                  <a href={`mailto:${COMPANY.email}`} className="hover:text-petroleo">
                    {COMPANY.email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-grafite/10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-grafite-500 sm:px-6">
            <span>© {new Date().getFullYear()} Limpa Aqui. Todos os direitos reservados.</span>
            <span className="inline-flex items-center gap-1.5">
              <QrCode className="h-3.5 w-3.5" aria-hidden /> Pix
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
