/**
 * Termos de Uso e Política de Privacidade.
 * Ao mudar o texto de forma relevante, troque TERMS_VERSION: quem já tem conta vai aceitar de novo ao entrar.
 * Preencha COMPANY com os dados reais da empresa (aparecem nas duas páginas).
 */
export const TERMS_VERSION = "2026-11-19";
export const TERMS_UPDATED = "19 de novembro de 2026";

export const COMPANY = {
  /** Razão social (ou nome completo do responsável, se pessoa física) */
  legalName: "",
  /** CNPJ (ou CPF do responsável) */
  document: "",
  /** E-mail para dúvidas, suporte e pedidos sobre dados pessoais (LGPD) */
  email: "",
  /** Cidade/UF do foro */
  forum: "Rio de Janeiro/RJ",
};

export const companyLabel = () =>
  COMPANY.legalName ? `${COMPANY.legalName}${COMPANY.document ? `, inscrita sob o nº ${COMPANY.document}` : ""}` : "a empresa responsável pelo Limpa Aqui";
export const contactLabel = () => (COMPANY.email ? COMPANY.email : "os canais de atendimento informados no site");
