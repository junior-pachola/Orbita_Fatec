export const CATEGORIES = {
  ti: "Gestão de T.I.",
  rh: "Recursos Humanos",
  admin: "Administrativo",
  saude: "Gestão Saúde",
  secretaria: "Secretaria",
  financeiro: "Financeiro"
};

export const MODULES = {
  dashboard: {
    id: "dashboard",
    title: "Meu Espaço",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    url: "/meu-espaco/index.html"
  },
  fidelidade: {
    id: "fidelidade",
    title: "Cartão FATEC",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg>`,
    url: "/fidelidade/index.html"
  },
  emprestimo: {
    id: "emprestimo",
    category: "ti",
    title: "Empréstimos",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    url: "/emprestimo/index.html"
  },
  agenda: {
    id: "agenda",
    category: "ti",
    title: "Agenda",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    url: "/agenda/index.html"
  },
  acessos: {
    id: "acessos",
    category: "ti",
    title: "Acessos",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    url: "/ti/acessos/index.html"
  },
  "gasto-ti": {
    id: "gasto-ti",
    category: "ti",
    title: "Gasto T.I.",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    url: "/ti/gasto-ti/index.html"
  },
  usuarios: {
    id: "usuarios",
    category: "admin",
    title: "Usuários",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    url: "/usuarios/index.html"
  },
  "carga-horaria": {
    id: "carga-horaria",
    category: "rh",
    title: "Carga Horária",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    url: "/rh/carga-horaria/index.html"
  },
  funcionarios: {
    id: "funcionarios",
    category: "rh",
    title: "Funcionários",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    url: "/rh/funcionarios/index.html"
  },
  empresas: {
    id: "empresas",
    category: "admin",
    title: "Parceiros",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 7v14M21 7v14M6 21V7M18 21V7M9 7h6M9 11h6M9 15h6M9 19h6"/></svg>`,
    url: "/empresas/index.html"
  },
  ferida: {
    id: "ferida",
    category: "saude",
    title: "Ferida",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z"/><polyline points="7 12 9.5 12 11 9.5 13 14.5 14.5 12 17 12"/></svg>`,
    url: "/saude/ferida/index.html"
  },
  "almoxarifado-feridas": {
    id: "almoxarifado-feridas",
    category: "saude",
    title: "Almoxarifado Feridas",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8L12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>`,
    url: "/saude/almoxarifado-feridas/index.html"
  },
  "almoxarifado-saude": {
    id: "almoxarifado-saude",
    category: "saude",
    title: "Almoxarifado Saúde",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 22V12h6v10"/><path d="M14 2H8a2 2 0 0 0-2 2v6l-3 3v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7l-3-3V4a2 2 0 0 0-2-2z"/></svg>`,
    url: "/saude/almoxarifado-saude/index.html"
  },
  "relatorio-dp": {
    id: "relatorio-dp",
    category: "secretaria",
    title: "Relatório DP",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`,
    url: "/secretaria/relatorio-dp/index.html"
  },
  licitacao: {
    id: "licitacao",
    category: "financeiro",
    title: "Licitação",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    url: "/financeiro/licitacao/index.html"
  },
  matriculas: {
    id: "matriculas",
    category: "financeiro",
    title: "Relatório Matrículas",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/></svg>`,
    url: "/financeiro/matriculas/index.html"
  },
  orcamento: {
    id: "orcamento",
    category: "financeiro",
    title: "Orçamento",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    url: "/financeiro/orcamento/index.html"
  },
  "avaliacao-docente": {
    id: "avaliacao-docente",
    category: "admin",
    title: "Avaliação Docente",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
    url: "/avaliacao-docente/index.html"
  }
};

export const ROLE_PERMISSIONS = {
  adm_l1: {
    label: "ADM N1",
    modules: ["dashboard", "fidelidade", "emprestimo", "agenda", "usuarios", "carga-horaria", "funcionarios", "empresas", "ferida", "almoxarifado-feridas", "almoxarifado-saude", "relatorio-dp", "acessos", "licitacao", "matriculas", "orcamento", "avaliacao-docente", "gasto-ti"]
  },
  adm_l2: {
    label: "ADM N2",
    modules: ["dashboard", "fidelidade", "emprestimo", "agenda", "usuarios", "carga-horaria", "funcionarios", "empresas", "ferida", "almoxarifado-feridas", "almoxarifado-saude", "relatorio-dp", "licitacao", "matriculas", "orcamento", "avaliacao-docente", "gasto-ti"]
  },
  ti: {
    label: "T.I.",
    modules: ["dashboard", "fidelidade", "emprestimo", "agenda", "usuarios", "acessos", "gasto-ti"]
  },
  rh: {
    label: "RH",
    modules: ["dashboard", "fidelidade", "carga-horaria", "funcionarios"]
  },
  financeiro: {
    label: "Financeiro",
    modules: ["dashboard", "fidelidade", "licitacao", "matriculas", "orcamento"]
  },
  // Coordenador perdeu acesso à Licitação (18/08) — passou a ser tarefa
  // exclusiva do Financeiro, pra não misturar semestre ativo entre uma
  // licitação em andamento e uma nova sendo montada.
  coordenador: {
    label: "Coordenador",
    modules: ["dashboard", "fidelidade", "avaliacao-docente"]
  },
  // O cargo "Secretaria" foi cadastrado na tela de Usuários com id `sec`
  // (não `secretaria`) — a chave aqui precisa bater com o id real da
  // coleção `roles`, senão o guard de 1º acesso (sem cache ainda no
  // navegador) cai no fallback de "visitante" e bloqueia sem nunca chegar
  // a ler a permissão real do Firestore.
  sec: {
    label: "Secretaria",
    modules: ["dashboard", "fidelidade", "matriculas"]
  },
  visitante: {
    label: "Visitante",
    modules: ["dashboard", "fidelidade"]
  }
};

export function hasPermission(role, moduleId) {
  const roleConfig = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS["visitante"];
  return roleConfig.modules.includes(moduleId);
}

export function getRoleConfig(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS["visitante"];
}

// Nível de acesso normalizado com retrocompatibilidade:
// inteiro (1/2/3) ou formato legado { view, execute }
export function getAccessLevel(perm) {
  if (perm === undefined || perm === null) return 1;
  if (typeof perm === "object") {
    if (perm.execute) return 3;
    if (perm.view) return 2;
    return 1;
  }
  return parseInt(perm) || 1;
}

// Nível efetivo: o override individual do usuário (users/{uid}.permissoes)
// sempre vence o nível do cargo quando definido para o módulo.
export function getEffectiveLevel(rolePerms, userOverrides, moduleId) {
  if (userOverrides && userOverrides[moduleId] !== undefined) {
    return getAccessLevel(userOverrides[moduleId]);
  }
  return getAccessLevel(rolePerms ? rolePerms[moduleId] : undefined);
}
