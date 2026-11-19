import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PublicLayout } from "@/features/marketplace/PublicLayout";
import { COMPANY, TERMS_UPDATED, companyLabel, contactLabel } from "@/lib/legal";

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PublicLayout>
      <article className="mx-auto max-w-3xl space-y-6 rounded-2xl bg-white p-6 text-sm leading-relaxed text-grafite shadow-sm sm:p-10" data-testid="legal-doc">
        <header>
          <h1 className="text-2xl font-semibold text-petroleo">{title}</h1>
          <p className="mt-1 text-xs text-grafite-500">Última atualização: {TERMS_UPDATED}</p>
        </header>
        {children}
        <p className="border-t border-grafite/5 pt-4 text-xs text-grafite-500">
          Veja também: <Link to="/termos" className="font-semibold text-petroleo hover:underline">Termos de Uso</Link> ·{" "}
          <Link to="/privacidade" className="font-semibold text-petroleo hover:underline">Política de Privacidade</Link>
        </p>
      </article>
    </PublicLayout>
  );
}

const H = ({ children }: { children: ReactNode }) => <h2 className="pt-2 text-base font-semibold text-petroleo">{children}</h2>;
const L = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-1 pl-5">
    {items.map((x, i) => (
      <li key={i}>{x}</li>
    ))}
  </ul>
);

export function TermsPage() {
  return (
    <Doc title="Termos de Uso">
      <p>
        Estes Termos regem o uso da plataforma <strong>Limpa Aqui</strong>, operada por {companyLabel()} (“Limpa Aqui”, “nós”). Ao criar uma conta ou usar a
        plataforma, você declara que leu, entendeu e aceita estes Termos e a <Link to="/privacidade" className="font-semibold text-petroleo hover:underline">Política de Privacidade</Link>.
      </p>

      <H>1. O que é o Limpa Aqui</H>
      <p>
        O Limpa Aqui é uma plataforma que (a) oferece ferramentas de gestão para lavanderias e profissionais de limpeza e (b) aproxima clientes
        (“anunciantes”), prestadores de serviço (autônomos e empresas) e entregadores independentes, inicialmente no estado do Rio de Janeiro.
        <strong> O Limpa Aqui não presta os serviços de limpeza nem de transporte</strong>: esses serviços são prestados diretamente pelos prestadores e
        entregadores, que são independentes e não têm vínculo de emprego com o Limpa Aqui.
      </p>

      <H>2. Cadastro e perfis</H>
      <L
        items={[
          "Você precisa ter 18 anos ou mais e informar dados verdadeiros e atualizados. A conta é pessoal e a senha é de sua responsabilidade.",
          "Uma mesma conta pode ter mais de um perfil: anunciante (contrata), prestador (oferece serviços) e entregador (faz coletas e devoluções).",
          "Entregadores só recebem corridas depois de aprovados pela administração. Podemos pedir informações adicionais para aprovar ou manter um perfil.",
          "Podemos suspender ou encerrar contas que violem estes Termos, a lei ou que coloquem outros usuários em risco.",
        ]}
      />

      <H>3. Contratação de serviços</H>
      <L
        items={[
          "O cliente pode contratar pelo perfil do prestador (preços do catálogo) ou publicar um anúncio e aceitar uma proposta. Antes de confirmar, a plataforma mostra o valor, a forma de pagamento e a forma de coleta e entrega.",
          "Preços, prazos, descrições e a qualidade do serviço são de responsabilidade do prestador. Serviços cobrados por peso ou sob orçamento podem ter o valor final confirmado pelo prestador.",
          "O prestador deve tratar os itens recebidos com cuidado e devolvê-los no prazo combinado. Problemas com o serviço devem ser resolvidos primeiro entre cliente e prestador; o Limpa Aqui pode ajudar na mediação.",
        ]}
      />

      <H>4. Pagamentos</H>
      <p>Cada pedido mostra a modalidade de pagamento escolhida:</p>
      <L
        items={[
          <>
            <strong>Pagamento direto ao prestador:</strong> o cliente paga ao prestador (Pix, dinheiro, cartão etc.), fora da plataforma. O Limpa Aqui não recebe nem
            guarda esse dinheiro e não responde por ele; o prestador registra o recebimento na plataforma.
          </>,
          <>
            <strong>Pagamento pelo app (Pix):</strong> o cliente paga ao Limpa Aqui por meio do nosso parceiro de pagamentos (SyncPay). O pedido só começa depois da
            confirmação do pagamento. O Limpa Aqui retém a comissão e repassa o restante ao prestador (e, quando houver, o valor da corrida ao entregador) na chave Pix
            cadastrada.
          </>,
          "Pedidos pagos pelo app e cancelados antes da execução, cobranças em duplicidade ou com valor errado são devolvidos ao cliente. Contestações abertas no banco (como o MED do Pix) podem suspender repasses até a conclusão.",
          "Para gerar o Pix, pedimos o CPF de quem paga, exigido pelo sistema bancário. O CPF é enviado diretamente ao parceiro de pagamentos e não é guardado pelo Limpa Aqui.",
        ]}
      />

      <H>5. Comissões, taxas e planos dos prestadores</H>
      <L
        items={[
          "O Limpa Aqui pode cobrar comissão sobre os pedidos feitos pela plataforma. Os percentuais e regras vigentes são informados ao prestador e valem para pedidos feitos depois da sua publicação. No pagamento direto, a comissão é cobrada do prestador depois; no pagamento pelo app, é descontada antes do repasse.",
          "Taxas de entrega são calculadas pela distância e pelas tarifas da região e mostradas ao cliente antes da contratação.",
          "Prestadores podem usar o plano gratuito ou assinar planos pagos, com recursos e limites descritos na tela “Meu plano”. A mensalidade é paga por Pix e vale pelo período informado; renovações antecipadas somam ao período restante. Sem pagamento, depois da tolerância informada, a conta volta ao plano gratuito, sem perda dos dados.",
          "Valores de planos, comissões e tarifas podem mudar com aviso prévio na plataforma; mudanças não afetam pedidos e períodos já pagos.",
        ]}
      />

      <H>6. Logística</H>
      <p>
        A coleta e a devolução são opcionais: o cliente pode levar e buscar, o prestador pode buscar e entregar, ou um entregador independente cadastrado pode fazer as
        corridas. Coleta e devolução são corridas separadas e podem ser feitas por entregadores diferentes. O entregador é responsável pelo transporte cuidadoso dos itens
        entre a coleta e a entrega.
      </p>

      <H>7. Condutas proibidas</H>
      <L
        items={[
          "Usar dados falsos, de terceiros ou contas de outras pessoas.",
          "Combinar fora da plataforma pedidos iniciados nela para evitar comissões, ou fazer qualquer fraude em pagamentos.",
          "Publicar conteúdo ofensivo, ilegal, enganoso ou que viole direitos de terceiros; usar a plataforma para fins ilícitos.",
          "Tentar acessar dados de outros usuários, burlar a segurança ou sobrecarregar o sistema.",
        ]}
      />

      <H>8. Responsabilidades e limitações</H>
      <p>
        O Limpa Aqui se esforça para manter a plataforma disponível e segura, mas não garante funcionamento ininterrupto. Na medida permitida pela lei, o Limpa Aqui não
        responde pela execução dos serviços, por danos causados por prestadores ou entregadores, nem por pagamentos feitos fora da plataforma. Nada nestes Termos afasta os
        direitos do consumidor previstos no Código de Defesa do Consumidor.
      </p>

      <H>9. Cancelamento da conta</H>
      <p>
        Você pode encerrar sua conta a qualquer momento. Pedidos em andamento e valores pendentes (repasses, comissões ou devoluções) continuam sendo tratados até a
        conclusão. Alguns registros podem ser mantidos pelo prazo exigido em lei, como descrito na Política de Privacidade.
      </p>

      <H>10. Mudanças nestes Termos</H>
      <p>Podemos atualizar estes Termos. Mudanças relevantes serão avisadas na plataforma e poderão exigir um novo aceite para continuar usando o serviço.</p>

      <H>11. Contato e foro</H>
      <p>
        Dúvidas: {contactLabel()}. Fica eleito o foro da comarca de {COMPANY.forum} para resolver questões relacionadas a estes Termos, ressalvado o direito do consumidor de
        propor ação no foro do seu domicílio.
      </p>
    </Doc>
  );
}

export function PrivacyPage() {
  return (
    <Doc title="Política de Privacidade">
      <p>
        Esta Política explica como {companyLabel()} (“Limpa Aqui”), na condição de controlador, trata os dados pessoais de quem usa a plataforma, de acordo com a Lei Geral
        de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>

      <H>1. Dados que coletamos</H>
      <L
        items={[
          <><strong>Conta:</strong> nome, e-mail, senha (guardada de forma criptografada) e WhatsApp.</>,
          <><strong>Endereços e localização:</strong> endereços cadastrados e coordenadas no mapa, para calcular distâncias, rotas e taxas de entrega. A localização do aparelho só é usada quando você permite, para ordenar a busca.</>,
          <><strong>Prestadores:</strong> dados da lavanderia (nome, endereço, horários, logotipo, serviços e preços), equipe e chave Pix para repasses.</>,
          <><strong>Entregadores:</strong> veículo, municípios de atuação e apenas os 4 últimos dígitos do CPF.</>,
          <><strong>Pedidos:</strong> itens, valores, fotos de antes e depois, comprovantes de pagamento enviados pelo prestador e histórico de situações.</>,
          <><strong>Pagamentos pelo app:</strong> valor, situação e identificadores da transação. O CPF de quem paga é enviado diretamente ao parceiro de pagamentos e <strong>não é armazenado</strong> pelo Limpa Aqui.</>,
          <><strong>Uso técnico:</strong> registros de acesso e de erros necessários à segurança e ao funcionamento.</>,
        ]}
      />

      <H>2. Para que usamos e com que base legal</H>
      <L
        items={[
          "Criar e manter sua conta, mostrar prestadores, intermediar contratações, pagamentos, entregas e repasses — execução de contrato (art. 7º, V).",
          "Cumprir obrigações legais e fiscais e guardar registros de acesso — cumprimento de obrigação legal (art. 7º, II).",
          "Prevenir fraudes, proteger a plataforma e melhorar o serviço — legítimo interesse (art. 7º, IX), sempre respeitando seus direitos.",
          "Comunicações sobre seus pedidos e sua conta. Mensagens promocionais, se houver, só com o seu consentimento, que pode ser retirado a qualquer momento.",
        ]}
      />

      <H>3. Com quem compartilhamos</H>
      <L
        items={[
          "Entre os participantes de um pedido: o prestador vê nome, WhatsApp e endereço do cliente; o entregador vê endereços e contatos apenas depois de aceitar a corrida. O público em geral vê só o bairro e o município do prestador, nunca o endereço completo nem o WhatsApp.",
          "Fornecedores que operam a plataforma por nossa conta: Supabase (banco de dados, login e arquivos), Vercel (hospedagem do site), Google Maps (mapas, endereços e rotas) e SyncPay (pagamentos Pix).",
          "Autoridades, quando exigido por lei ou ordem judicial.",
        ]}
      />
      <p>Não vendemos dados pessoais. Alguns fornecedores podem tratar dados fora do Brasil, com as garantias exigidas pela LGPD.</p>

      <H>4. Por quanto tempo guardamos</H>
      <p>
        Enquanto a conta estiver ativa e pelo tempo necessário às finalidades acima. Registros de acesso são guardados por 6 meses (Marco Civil da Internet) e registros
        financeiros e fiscais pelo prazo exigido em lei. O livro-razão financeiro não é apagado, para fins de auditoria. Ao encerrar a conta, os demais dados são excluídos ou
        anonimizados.
      </p>

      <H>5. Seus direitos</H>
      <p>
        Você pode pedir: confirmação e acesso aos seus dados, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre
        compartilhamentos, revogação de consentimento e revisão de decisões automatizadas. Muitos dados podem ser corrigidos direto na sua conta. Para os demais pedidos,
        fale conosco em {contactLabel()}. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
      </p>

      <H>6. Segurança</H>
      <p>
        Usamos conexão criptografada, senhas protegidas, controle de acesso por usuário em cada tabela do banco, arquivos privados para fotos e comprovantes e credenciais
        de pagamento guardadas em cofre criptografado. Nenhum sistema é 100% seguro; se houver um incidente relevante, avisaremos os afetados e a ANPD como manda a lei.
      </p>

      <H>7. Cookies e armazenamento no navegador</H>
      <p>Usamos apenas o armazenamento necessário para manter você conectado e lembrar preferências. Não usamos cookies de publicidade.</p>

      <H>8. Menores de idade</H>
      <p>A plataforma é destinada a maiores de 18 anos.</p>

      <H>9. Encarregado e contato</H>
      <p>
        Encarregado pelo tratamento de dados (DPO) e canal de atendimento: {contactLabel()}. Esta Política pode ser atualizada; mudanças relevantes serão avisadas na
        plataforma.
      </p>
    </Doc>
  );
}
