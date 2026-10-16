// ================================================================
//  ÓRBITA — MÓDULO EMPRÉSTIMO
//  Firebase Firestore + Auth Guard
// ================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAnalytics }  from "https://www.gstatic.com/firebasejs/10.9.0/firebase-analytics.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDocs, onSnapshot, getDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

import { firebaseConfig } from "../core/firebase-config.js";
import { setupLayout, getCachedAuth, setCachedAuth, clearCachedAuth } from "../core/layout.js";
import { escapeHTML as esc } from "../core/security.js";
import { getEffectiveLevel } from "../core/permissions.js";

const fbApp  = initializeApp(firebaseConfig);
const analytics = getAnalytics(fbApp);
const auth   = getAuth(fbApp);
const db     = getFirestore(fbApp);

const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.')) 
  ? `http://${window.location.hostname}:3000/api` 
  : '/api';

// O token do cache (localStorage) expira em 1h. No celular, ao abrir pelo QR
// depois de um tempo parado, a página tentava carregar com o token vencido,
// tomava 401 em silêncio e ficava vazia até o Firebase restaurar a sessão.
function tokenValido(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 - Date.now() > 60 * 1000; // margem de 1 min
  } catch (e) {
    return false;
  }
}

async function obterToken(forcarFirebase = false) {
  // Sessão real do Firebase já restaurada: renova sozinha quando precisa
  if (auth.currentUser) return auth.currentUser.getIdToken();
  if (!forcarFirebase && currentUser && typeof currentUser.getIdToken === 'function') {
    const cachedToken = await currentUser.getIdToken();
    if (cachedToken && tokenValido(cachedToken)) return cachedToken;
  }
  // Token do cache vencido: espera o Firebase restaurar a sessão e pega um novo
  await auth.authStateReady();
  return auth.currentUser ? auth.currentUser.getIdToken() : '';
}

async function apiFetch(endpoint, options = {}) {
  const doFetch = async (token) => fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  let res = await doFetch(await obterToken());
  if (res.status === 401) {
    // Token recusado: tenta uma vez com token novo do Firebase
    res = await doFetch(await obterToken(true));
  }
  if (!res.ok) throw new Error(`Erro na API: ${res.status}`);
  return res.json();
}


// ---- Constants ----
const SALAS = [
  "LAB SOLOS","LAB-INF20","LAB. SEMIO","LF-MED","LAB. ARQ",
  "M.A. 1","M.A. 2"
];

let notebooksDB = [];
let currentUser  = null;

// ---- Categories Management ----
let categorias = ["Notebook", "Passador", "Caixa de Som", "Projetor"];

function loadCategories() {
  const saved = localStorage.getItem('emprestimo_categorias');
  let loadedCats = ["Notebook", "Passador", "Caixa de Som", "Projetor"];
  if (saved) {
    try {
      loadedCats = JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  
  // Limpa loadedCats de valores inválidos ou legados como "Outros"
  loadedCats = loadedCats.filter(c => c && c.trim() !== '' && c.toLowerCase() !== 'outros' && c.toLowerCase() !== 'outro');
  
  // Extrai categorias exclusivas do Firestore
  const dbCats = new Set();
  notebooksDB.forEach(n => {
    if (n.tipo) {
      const normalized = n.tipo.trim();
      if (normalized && normalized.toLowerCase() !== 'outros' && normalized.toLowerCase() !== 'outro') {
        dbCats.add(normalized);
      }
    }
  });
  
  const merged = [...loadedCats];
  dbCats.forEach(c => {
    if (!merged.some(m => m.toLowerCase() === c.toLowerCase())) {
      merged.push(c);
    }
  });
  
  // Remove qualquer residual de "Outros"
  categorias = merged.filter(c => c.toLowerCase() !== 'outros' && c.toLowerCase() !== 'outro');

  // As categorias eram listadas na ordem em que foram descobertas/criadas,
  // o que deixava as abas e as seções do grid fora de ordem conforme iam
  // surgindo novos tipos de item. Agora ficam em ordem alfabética — com
  // "Notebook" sempre primeiro, por ser o item mais comum.
  categorias = categorias
    .filter(c => c.toLowerCase() !== 'notebook')
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  categorias.unshift('Notebook');
}

function saveCategories() {
  localStorage.setItem('emprestimo_categorias', JSON.stringify(categorias));
}

function populateCategorySelects() {
  const cadSelect = document.getElementById('cad-tipo');
  const filterSelect = document.getElementById('filter-categoria');
  
  if (cadSelect) {
    const curVal = cadSelect.value;
    cadSelect.innerHTML = '';
    categorias.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      cadSelect.appendChild(opt);
    });
    if (curVal && categorias.includes(curVal)) {
      cadSelect.value = curVal;
    }
  }
  
  if (filterSelect) {
    const curVal = filterSelect.value || 'Todos';
    filterSelect.innerHTML = '<option value="Todos">Todos</option>';
    categorias.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      filterSelect.appendChild(opt);
    });
    if (categorias.includes(curVal)) {
      filterSelect.value = curVal;
    } else {
      filterSelect.value = 'Todos';
    }
  }
}

function setupCategoryManagement() {
  const btnAdd = document.getElementById('btn-add-tipo');
  const btnSave = document.getElementById('btn-save-tipo');
  const btnCancel = document.getElementById('btn-cancel-tipo');
  const newCatGroup = document.getElementById('new-category-group');
  const inputNewCat = document.getElementById('cad-tipo-novo');
  const selectCat = document.getElementById('cad-tipo');
  
  if (btnAdd && newCatGroup) {
    btnAdd.onclick = () => {
      newCatGroup.classList.remove('hidden');
      if (inputNewCat) {
        inputNewCat.value = '';
        inputNewCat.focus();
      }
    };
  }
  
  if (btnCancel && newCatGroup) {
    btnCancel.onclick = () => {
      newCatGroup.classList.add('hidden');
      if (inputNewCat) inputNewCat.value = '';
    };
  }
  
  if (btnSave && inputNewCat && selectCat) {
    btnSave.onclick = () => {
      const value = inputNewCat.value.trim();
      if (!value) return;
      
      const exists = categorias.some(c => c.toLowerCase() === value.toLowerCase());
      if (exists) {
        alert('Essa categoria já existe.');
        return;
      }
      
      categorias.push(value);
      saveCategories();
      populateCategorySelects();
      renderCategoryTabs();
      
      selectCat.value = value;
      newCatGroup.classList.add('hidden');
      inputNewCat.value = '';
    };
  }
}

// ---- Ícone de cada item (SVG de traço, padrão do Órbita) ----
// Procura primeiro no nome do item (o Empréstimo Rápido grava tudo como
// "Notebook", então "JBL_02" só é reconhecido pelo nome) e depois no tipo.
const ICONES = [
  [/jbl|caixa|som|speaker/i,                 'som'],
  [/passador|apresentador|presenter|laser/i, 'passador'],
  [/projetor|datashow|data show/i,           'projetor'],
  [/microfone|\bmic\b/i,                     'microfone'],
  [/fone|headset|headphone/i,                'fone'],
  [/hdmi|cabo|vga|extens|adaptador|carregador|fonte|r[eé]gua/i, 'cabo'],
  [/mouse/i,                                 'mouse'],
  [/teclado/i,                               'teclado'],
  [/tablet|ipad|celular/i,                   'tablet'],
  [/c[aâ]mera|webcam/i,                      'camera'],
  [/controle|remote/i,                       'controle'],
  [/monitor|tv\b|televis/i,                  'monitor'],
  [/note|not_|\bnot\b|laptop|chromebook/i,   'notebook'],
];

const ICONE_SVG = {
  notebook:  '<rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/>',
  som:       '<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><line x1="12" y1="6" x2="12.01" y2="6"/>',
  passador:  '<rect x="8" y="2" width="8" height="20" rx="4"/><circle cx="12" cy="8" r="1.5"/><line x1="12" y1="13" x2="12" y2="16"/>',
  projetor:  '<rect x="2" y="7" width="20" height="11" rx="2"/><circle cx="8" cy="12.5" r="3"/><line x1="15" y1="11" x2="18" y2="11"/><line x1="15" y1="14" x2="18" y2="14"/>',
  microfone: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>',
  fone:      '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
  cabo:      '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
  mouse:     '<rect x="6" y="2" width="12" height="20" rx="6"/><line x1="12" y1="6" x2="12" y2="10"/>',
  teclado:   '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  tablet:    '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  camera:    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  controle:  '<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M15 11h.01M18 13h.01"/>',
  monitor:   '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  caixa:     '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
};

function chaveIcone(texto) {
  for (const [regex, chave] of ICONES) if (regex.test(texto || '')) return chave;
  return null;
}

// variante: '' (quadrado 34px), 'mini' (24px) ou 'inline' (só o traço, dentro de texto)
function iconeHtml(chave, variante = '') {
  return `<span class="item-icone ${variante}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONE_SVG[chave] || ICONE_SVG.caixa}</svg></span>`;
}

function iconeItem(n, variante = '') {
  const chave = !n ? 'caixa'
    : chaveIcone(n.id) || (n.temporario ? null : chaveIcone(n.tipo)) || (n.temporario ? 'caixa' : 'notebook');
  return iconeHtml(chave, variante);
}

function iconeCategoria(cat, variante = 'inline') {
  return iconeHtml(chaveIcone(cat) || 'caixa', variante);
}

function renderCategoryTabs() {
  const container = document.getElementById('category-tabs-container');
  if (!container) return;
  
  const currentCategory = document.getElementById('filter-categoria') 
    ? document.getElementById('filter-categoria').value 
    : 'Todos';
    
  container.innerHTML = '';
  
  // 1. Aba "Todos"
  const allTab = document.createElement('button');
  allTab.type = 'button';
  allTab.dataset.category = 'Todos';
  allTab.className = `tab-pill ${currentCategory === 'Todos' ? 'active' : ''}`;
  allTab.textContent = 'Todos os Itens';
  allTab.onclick = () => selectCategoryTab('Todos');
  container.appendChild(allTab);
  
  // 2. Abas de cada categoria
  categorias.forEach(cat => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.dataset.category = cat;
    tab.className = `tab-pill ${currentCategory === cat ? 'active' : ''}`;
    
    // Contagem de itens nessa categoria para mostrar na aba
    const count = notebooksDB.filter(n => n.tipo === cat).length;
    tab.innerHTML = `${iconeCategoria(cat)} ${esc(cat)} <span style="opacity:.7; font-variant-numeric:tabular-nums;">${count}</span>`;
    tab.onclick = () => selectCategoryTab(cat);
    container.appendChild(tab);
  });
}

function selectCategoryTab(category) {
  const catSelect = document.getElementById('filter-categoria');
  if (catSelect) {
    catSelect.value = category;
  }
  
  // Atualiza classe ativa das abas
  const container = document.getElementById('category-tabs-container');
  if (container) {
    container.querySelectorAll('.tab-pill').forEach(btn => {
      if (btn.dataset.category === category) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  
  applyFilters();
}

// ================================================================
//  DETECT WHICH PAGE WE ARE ON
// ================================================================
const isDashboard   = !!document.getElementById('notebook-grid');
const isMovimentar  = !!document.getElementById('movimentacao-form');

let appInitialized = false;
let initializedRole = null;

async function initApp(user, role) {
  if (appInitialized && initializedRole === role) return;
  appInitialized = true;
  initializedRole = role;

  // Set avatar initial - Prioritiza o nome cadastrado no Perfil do Firebase
  const userName = user.displayName || user.email.split('@')[0];
  const av       = document.getElementById('header-avatar');
  const nameEl   = document.getElementById('user-name-display');
  if (av) av.textContent = userName.charAt(0).toUpperCase();
  if (nameEl) nameEl.textContent = userName;

  const roleBadge = document.getElementById('role-badge');
  if (roleBadge) {
    roleBadge.textContent = (role === 'adm_l1' ? 'ADM N1' : (role === 'adm_l2' ? 'ADM N2' : role.toUpperCase()));
    if (role === 'adm_l1' || role === 'adm_l2') {
      roleBadge.style.background = 'rgba(235, 112, 37, 0.1)';
      roleBadge.style.color = 'var(--orange)';
    } else {
      roleBadge.style.background = 'rgba(124, 58, 237, 0.1)';
      roleBadge.style.color = 'var(--purple-bright)';
    }
  }

  // Esconde o bloqueio se estiver logado
  const guard = document.getElementById('auth-guard');
  if (guard) guard.classList.add('hidden');
  
  setupLayout(user, role, 'emprestimo', async () => {
    clearCachedAuth();
    await signOut(auth);
    window.location.href = '../auth/login.html';
  });

  await loadNotebooks();

  if (isDashboard)  initDashboard();
  if (isMovimentar) initMovimentar();
}

// Check cache immediately
const cached = getCachedAuth();
if (cached && ['adm_l1', 'adm_l2', 'ti'].includes(cached.role)) {
  currentUser = cached.user;
  initApp(cached.user, cached.role);
}

// ---- Auth Guard ----
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clearCachedAuth();
    const guard = document.getElementById('auth-guard');
    if (guard) guard.classList.remove('hidden');
    const loginWrapper = document.getElementById('login-wrapper');
    if (loginWrapper) {
      const authLoading = document.getElementById('auth-loading');
      if (authLoading) authLoading.classList.add('hidden');
      loginWrapper.classList.remove('hidden');
      
      const loginForm = document.getElementById('login-form-movimentar');
      if (loginForm) {
        loginForm.onsubmit = async (e) => {
          e.preventDefault();
          const em = document.getElementById('login-email-mov').value;
          const pw = document.getElementById('login-pw-mov').value;
          const btn = loginForm.querySelector('button');
          btn.textContent = 'Autenticando...';
          btn.disabled = true;
          try {
            await signInWithEmailAndPassword(auth, em, pw);
            // onAuthStateChanged will naturally fire again and hide the modal
          } catch (err) {
            alert('Erro ao fazer login: ' + err.message);
            btn.textContent = 'Entrar e Movimentar';
            btn.disabled = false;
          }
        };
      }
    } else {
      if (!isMovimentar) window.location.href = '../meu-espaco/index.html';
    }
    return;
  }
  
  currentUser = user;

  // Buscar Papel (Role) e overrides individuais via API
  // Salva o token novo logo, para os próximos acessos não usarem um vencido
  const token = await user.getIdToken();
  setCachedAuth(user, null, token);

  // /me e /config/permissions em paralelo (antes era um depois do outro)
  const [meRes, permsRes] = await Promise.allSettled([
    apiFetch('/usuarios/me'),
    apiFetch('/usuarios/config/permissions')
  ]);

  let role = 'visitante';
  let meuOverrides = null;
  if (meRes.status === 'fulfilled') {
    role = meRes.value.role || 'visitante';
    meuOverrides = meRes.value.permissoes || null;
  } else {
    role = cached ? cached.role : 'visitante';
  }

  // Nível EFETIVO: override individual do usuário vence o do cargo
  let userLevel = 1;
  if (permsRes.status === 'fulfilled') {
    userLevel = getEffectiveLevel(permsRes.value[role] || {}, meuOverrides, 'emprestimo');
  }

  setCachedAuth(user, role, token);

  // Verifica se pode VER o módulo (nível >= 2)
  if (role !== 'adm_l1' && userLevel < 2) {
    window.location.href = '../meu-espaco/index.html';
    return;
  }

  // Se não puder EXECUTAR (nível >= 3), esconde botões globais
  if (role !== 'adm_l1' && userLevel < 3) {
    document.body.classList.add('hide-execute');
  } else {
    document.body.classList.remove('hide-execute');
  }

  if (!appInitialized || initializedRole !== role || (cached && (cached.user.displayName !== user.displayName || cached.user.email !== user.email))) {
    initApp(user, role);
  }
});

// ================================================================
//  DATA LOADING
// ================================================================
async function loadNotebooks(fresh = false) {
  try {
    notebooksDB = await apiFetch(`/emprestimos${fresh ? '?fresh=1' : ''}`);
    // Normaliza itens legados (sem tipo, 'Outros', 'outro', 'notbooks', etc.) para 'Notebook'
    notebooksDB.forEach(n => {
      if (!n.tipo || n.tipo.trim() === '' || n.tipo.toLowerCase() === 'outros' || n.tipo.toLowerCase() === 'outro' || n.tipo.toLowerCase() === 'notbooks' || n.tipo.toLowerCase() === 'notbook') {
        n.tipo = 'Notebook';
      }
    });
    // Encaixa o tipo na grafia exata de uma categoria já conhecida (ex.:
    // "passador"/"Passador " salvo com case ou espaço diferente do cadastro
    // "Passador"). Sem isso, o filtro por categoria (comparação exata mais
    // abaixo) deixava alguns itens de fora da aba certa, e o agrupamento do
    // grid abria uma seção extra duplicada (uma "Passador", outra "passador")
    // em vez de juntar tudo numa seção só.
    notebooksDB.forEach(n => {
      const bruto = (n.tipo || '').trim();
      const match = categorias.find(c => c.toLowerCase() === bruto.toLowerCase());
      n.tipo = match || bruto;
    });

    if (isDashboard) {
      loadCategories();
      populateCategorySelects();
      renderCategoryTabs();
    }
  } catch (err) {
    console.error("Erro ao buscar da API:", err);
  }
}

function fmt(iso) {
  return new Date(iso).toLocaleString('pt-BR',{ day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ================================================================
//  DASHBOARD
// ================================================================
function initDashboard() {
  const mainEl  = document.getElementById('dashboard-view');
  mainEl.classList.remove('hidden');

  // Populate sala filter (datalist — permite digitar/pesquisar, não só selecionar)
  const salasDatalist = document.getElementById('filter-salas-list');
  SALAS.forEach(s => { const o=document.createElement('option'); o.value=s; salasDatalist.appendChild(o); });

  // Populate categories initially
  loadCategories();
  populateCategorySelects();
  setupCategoryManagement();
  renderCategoryTabs();

  renderGrid(notebooksDB);

  // Polling via API REST para simular realtime
  setInterval(async () => {
    if (document.hidden) return; // Ignorar se a aba estiver oculta/inativa
    try {
      notebooksDB = await apiFetch('/emprestimos');
      applyFilters();
    } catch(err) {}
  }, 120000);

  // Filters
  document.getElementById('search-input').addEventListener('input',  applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-categoria').addEventListener('change', (e) => {
    selectCategoryTab(e.target.value);
  });
  document.getElementById('filter-local').addEventListener('change',  applyFilters);
  document.getElementById('filter-sala').addEventListener('input',    applyFilters);

  // Click summary cards to filter
  document.querySelectorAll('.status-summary .stat-item').forEach(item => {
    item.addEventListener('click', () => {
      const filterVal = item.dataset.filter;
      const statusSelect = document.getElementById('filter-status');
      if (statusSelect && filterVal) {
        statusSelect.value = filterVal;
        applyFilters();
      }
    });
  });

  // Cadastro form submit listener
  document.getElementById('form-cadastro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('cad-id').value.trim();
    const tipo = document.getElementById('cad-tipo').value.trim();
    const temQrCode = document.getElementById('cad-tem-qr').checked;
    
    if (!id || !tipo) return;
    
    // Validar duplicidade
    const existing = notebooksDB.find(n => n.id.toLowerCase() === id.toLowerCase());
    if (existing) {
      alert(`Erro: Já existe um item cadastrado com o identificador "${id}".`);
      return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Cadastrando...';
    submitBtn.disabled = true;
    
    const userName = currentUser.displayName || currentUser.email.split('@')[0];
    
    const newItem = {
      id,
      tipo,
      temQrCode,
      status: 'guardado',
      local: 'T.I.',
      responsavel: userName,
      updatedAt: new Date().toISOString(),
      observacao: ''
    };
    
    try {
      await apiFetch(`/emprestimos/${id}`, {
        method: 'PUT',
        body: JSON.stringify(newItem)
      });
      
      fecharCadastro();

      // Recarregar itens e atualizar grid (fresh: acabamos de escrever)
      await loadNotebooks(true);
      applyFilters();
    } catch (err) {
      console.error(err);
      alert('Erro ao cadastrar item: ' + err.message);
    } finally {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });

  // Grid click delegation
  const grid = document.getElementById('notebook-grid');

  grid.addEventListener('click', async (e) => {
    // Pin button or Pinned Comment Click
    const pinBtn = e.target.closest('.btn-pin');
    const cardPinnedComment = e.target.closest('.card-pinned-comment');
    const pinTargetBtn = pinBtn || cardPinnedComment;
    if (pinTargetBtn) {
      const id   = pinTargetBtn.dataset.id;
      const note = notebooksDB.find(n => n.id === id);
      if (!note) return;
      
      const newComment = prompt(`Editar comentário fixado para ${id}:\n(Deixe em branco para remover)`, note.comentarioFixado || "");
      if (newComment !== null) {
        note.comentarioFixado = newComment.trim();
        note.updatedAt = new Date().toISOString();
        await apiFetch(`/emprestimos/${id}`, { method: 'PUT', body: JSON.stringify(note) });
        applyFilters(); // Refresh UI
      }
      return;
    }

    // Devolver tudo (card de grupo)
    const devolverGrupoBtn = e.target.closest('.btn-devolver-grupo');
    if (devolverGrupoBtn) {
      const grupoId = devolverGrupoBtn.dataset.grupo;
      const itens = notebooksDB.filter(n => n.grupoId === grupoId && (n.status === 'emprestado' || n.status === 'cedido'));
      if (!itens.length) return;
      const normais = itens.filter(n => !n.temporario);
      let local = 'T.I.';
      if (normais.length) {
        local = await escolherLocalGuarda(normais);
        if (!local) return;
      } else if (!confirm(`Devolver todos os ${itens.length} itens temporários? Eles serão removidos do painel.`)) {
        return;
      }

      const originalText = devolverGrupoBtn.textContent;
      devolverGrupoBtn.textContent = 'Devolvendo...';
      devolverGrupoBtn.disabled = true;
      const devolvidos = [];
      try {
        for (const note of itens) {
          await devolverItem(note, local);
          devolvidos.push(note.id);
        }
      } catch (err) {
        console.error(err);
        alert(`Erro ao devolver: ${err.message}${devolvidos.length ? `\n\nJá devolvidos: ${devolvidos.join(', ')}` : ''}`);
        devolverGrupoBtn.textContent = originalText;
        devolverGrupoBtn.disabled = false;
      }
      await loadNotebooks(true);
      applyFilters();
      return;
    }

    // Devolver button
    const devolverBtn = e.target.closest('.btn-devolver');
    if (devolverBtn) {
      const id = devolverBtn.dataset.id;
      const note = notebooksDB.find(n => n.id === id);
      if (!note) return;
      let local = 'T.I.';
      if (!note.temporario) {
        local = await escolherLocalGuarda([note]);
        if (!local) return;
      }

      const originalText = devolverBtn.textContent;
      devolverBtn.textContent = note.temporario ? 'Removendo...' : 'Processando...';
      devolverBtn.disabled = true;
      try {
        await devolverItem(note, local);
        await loadNotebooks(true);
        applyFilters();
      } catch (err) {
        console.error(err);
        alert((note.temporario ? 'Erro ao excluir item temporário: ' : 'Erro ao devolver item: ') + err.message);
        devolverBtn.textContent = originalText;
        devolverBtn.disabled = false;
      }
      return;
    }

    // Lock button
    const lockBtn = e.target.closest('.btn-lock');
    if (lockBtn) {
      const id   = lockBtn.dataset.id;
      const note = notebooksDB.find(n => n.id === id);
      if (!note) return;
      if (note.status === 'reservado') {
        if (confirm(`Deseja LIBERAR o ${id}? Ele voltará para Guardado.`)) {
          note.status='guardado'; note.observacao=''; note.updatedAt=new Date().toISOString();
          await apiFetch(`/emprestimos/${id}`, { method: 'PUT', body: JSON.stringify(note) });
          applyFilters(); // Atualiza UI rapidamente
        }
      } else {
        document.getElementById('reserva-notebook-id').value = id;
        document.getElementById('reserva-subtitle').textContent = `Reservando ${id}`;
        document.getElementById('modal-reserva').classList.add('active');
      }
      return;
    }
    // QR button
    const qrBtn = e.target.closest('.btn-qr');
    if (qrBtn) { abrirQR(qrBtn.dataset.id); return; }

    // Card click (Historico)
    const card = e.target.closest('.notebook-card');
    if (card && !e.target.closest('.card-actions') && !e.target.closest('a') && !e.target.closest('button')) {
      abrirHistorico(card.dataset.id);
    }
  });

  // Reserva form
  document.getElementById('form-reserva').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id         = document.getElementById('reserva-notebook-id').value;
    const dia        = document.getElementById('reserva-dia').value;
    const devolucao  = document.getElementById('reserva-devolucao').value;
    const requerente = document.getElementById('reserva-requerente').value;
    const motivo     = document.getElementById('reserva-motivo').value;
    
    const note = notebooksDB.find(n => n.id === id);
    if (!note) return;
    
    note.status = 'reservado'; 
    note.observacao = motivo;
    note.dataReserva = dia;
    note.dataDevolucao = devolucao;
    note.requerente = requerente;
    note.updatedAt = new Date().toISOString();
    note.responsavel = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Desconhecido';
    
    await apiFetch(`/emprestimos/${id}`, { method: 'PUT', body: JSON.stringify(note) });
    applyFilters();
    fecharModalReserva();
  });

  // QR modal buttons
  const qrC = document.getElementById('qr-modal');
  document.getElementById('btn-imprimir-qr').addEventListener('click', () => window.print());
  document.getElementById('btn-baixar-qr').addEventListener('click', () => {
    let sourceElement = document.querySelector('#qr-code-canvas canvas');
    if (!sourceElement || sourceElement.style.display === 'none') {
      sourceElement = document.querySelector('#qr-code-canvas img');
    }
    
    if (sourceElement) {
      const notebookId = document.getElementById('qr-label-name').textContent;
      const compCanvas = document.createElement('canvas');
      const ctx = compCanvas.getContext('2d');
      
      const qrSize = 200; 
      const padding = 20;
      const textHeight = 40;
      
      compCanvas.width = qrSize + (padding * 2);
      compCanvas.height = qrSize + (padding * 2) + textHeight;
      
      // Fundo branco
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, compCanvas.width, compCanvas.height);
      
      try {
        // Desenha o QR
        ctx.drawImage(sourceElement, padding, padding, qrSize, qrSize);
        
        // Desenha o nome do notebook
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(notebookId, compCanvas.width / 2, compCanvas.height - padding - 5);
        
        // Dispara o download
        const a = document.createElement('a');
        a.href = compCanvas.toDataURL('image/png');
        a.download = `${notebookId}_etiqueta.png`;
        a.click();
      } catch (err) {
        console.error("Erro ao gerar a etiqueta:", err);
      }
    }
  });

  // Registra o form de Empréstimo Rápido
  setupEmprestimoRapidoForm();
}

// Pergunta onde guardar antes de devolver. Resolve com o local escolhido ou null (cancelou).
function escolherLocalGuarda(itens) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    const sugerido = itens.length === 1 && ['T.I.', 'Carrinho'].includes(itens[0].local) ? itens[0].local : 'T.I.';
    overlay.innerHTML = `
      <div class="modal-box" style="max-width: 380px; padding: 1.25rem; border-radius: 16px; text-align:left;">
        <h3 style="font-weight:800; margin:0 0 0.25rem; font-size:1rem;">Onde vai guardar?</h3>
        <p style="color:var(--text-secondary); font-size:0.8rem; margin:0 0 0.75rem;">${itens.length === 1 ? `Devolvendo <strong>${esc(itens[0].id)}</strong>` : `Devolvendo ${itens.length} itens: ${itens.map(i => `<strong>${esc(i.id)}</strong>`).join(', ')}`}</p>
        <div style="display:flex; gap:0.5rem; margin-bottom:1rem;">
          ${['T.I.', 'Carrinho'].map(l => `
            <label style="flex:1; display:flex; align-items:center; justify-content:center; gap:0.4rem; padding:0.7rem; border:1.5px solid var(--border-color); border-radius:10px; cursor:pointer; font-weight:700; font-size:0.9rem;">
              <input type="radio" name="local-guarda" value="${l}" ${l === sugerido ? 'checked' : ''} style="accent-color:var(--primary-blue);"> ${l === 'T.I.' ? '🖥️' : '🛒'} ${l}
            </label>`).join('')}
        </div>
        <div style="display:flex; gap:0.5rem;">
          <button type="button" data-acao="cancelar" class="btn btn-secondary" style="flex:1; height:38px; border-radius:8px;">Cancelar</button>
          <button type="button" data-acao="ok" class="btn" style="flex:1.5; height:38px; border-radius:8px; background:linear-gradient(135deg, #10b981, #059669); color:white; border:none; font-weight:700;">Devolver</button>
        </div>
      </div>`;
    const fechar = (valor) => { overlay.remove(); resolve(valor); };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return fechar(null);
      const acao = e.target.closest('button[data-acao]')?.dataset.acao;
      if (acao === 'cancelar') fechar(null);
      if (acao === 'ok') fechar(overlay.querySelector('input[name="local-guarda"]:checked')?.value || 'T.I.');
    });
    document.body.appendChild(overlay);
  });
}

// Devolve um item: temporário é removido; normal volta para Guardado no local escolhido e sai do grupo
async function devolverItem(note, local = 'T.I.') {
  if (note.temporario) {
    await apiFetch(`/emprestimos/${note.id}`, { method: 'DELETE' });
    return;
  }
  const userName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Desconhecido';
  await apiFetch(`/emprestimos/${note.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...note,
      status: 'guardado',
      local,
      sala: '',
      funcionario: '',
      setor: '',
      requerente: '',
      observacao: '',
      grupoId: '',
      responsavel: userName,
      updatedAt: new Date().toISOString()
    })
  });
}

// Identificador de um empréstimo feito com vários itens juntos
function novoGrupoId() {
  return 'G' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

window.fecharModalReserva = function() {
  document.getElementById('modal-reserva').classList.remove('active');
  document.getElementById('form-reserva').reset();
};

window.abrirHistorico = function(id) {
  const note = notebooksDB.find(n => n.id === id);
  if (!note) return;
  
  document.getElementById('historico-subtitle').textContent = `Últimas movimentações de ${id}`;
  const listEl = document.getElementById('historico-list');
  listEl.innerHTML = '';
  
  if (!note.historico || note.historico.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-muted); text-align:center;">Nenhum histórico encontrado.</p>';
  } else {
    note.historico.forEach(evento => {
      let detalhe = '';
      if (evento.status === 'emprestado') detalhe = `Sala ${esc(evento.sala)} - Req: ${esc(evento.requerente)}`;
      else if (evento.status === 'cedido') detalhe = `Para: ${esc(evento.funcionario)} (${esc(evento.setor)})`;
      else if (evento.status === 'guardado') detalhe = `Local: ${esc(evento.local)}`;
      else if (evento.status === 'reservado') detalhe = `Motivo: ${esc(evento.observacao)}`;

      const dt = evento.updatedAt ? new Date(evento.updatedAt).toLocaleString('pt-BR') : '---';
      
      const item = document.createElement('div');
      item.style.cssText = 'padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 8px; border-left: 4px solid var(--c-' + evento.status + ');';
      item.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
          <strong>${esc(evento.status.toUpperCase())}</strong>
          <span style="font-size:0.8rem; color:var(--text-muted);">${dt}</span>
        </div>
        <div style="font-size:0.9rem; color:var(--text-secondary); margin-bottom:0.3rem;">
          ${detalhe}
        </div>
        <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
          <span style="color:var(--purple-bright);">👤 ${esc(evento.responsavel)}</span>
          ${evento.observacao && evento.status !== 'reservado' ? `<span style="font-style:italic; color:var(--text-muted);">💬 ${esc(evento.observacao)}</span>` : ''}
        </div>
      `;
      listEl.appendChild(item);
    });
  }
  
  document.getElementById('modal-historico').classList.add('active');
};

window.fecharModalHistorico = function() {
  document.getElementById('modal-historico').classList.remove('active');
};

window.abrirCadastro = function() {
  document.getElementById('modal-cadastro').classList.add('active');
};

window.fecharCadastro = function() {
  document.getElementById('modal-cadastro').classList.remove('active');
  document.getElementById('form-cadastro').reset();
};

// ================================================================
//  EMPRÉSTIMO RÁPIDO — Cadastra e empresta item em um único fluxo
// ================================================================

function populateERTipoSelect() {
  const sel = document.getElementById('er-tipo');
  if (!sel) return;
  sel.innerHTML = '';
  categorias.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    sel.appendChild(opt);
  });
}

function setupERDestinoToggle() {
  const radios = document.querySelectorAll('input[name="er-destino"]');
  const dynFields = document.getElementById('er-dynamic-fields');
  const salaLabel = document.getElementById('er-dest-sala-label');
  const funcLabel = document.getElementById('er-dest-func-label');

  function renderDynFields(tipo) {
    if (!dynFields) return;
    // Reset visual
    salaLabel.style.borderColor = 'var(--border-color)';
    funcLabel.style.borderColor = 'var(--border-color)';

    if (tipo === 'sala') {
      salaLabel.style.borderColor = 'var(--primary-blue)';
      dynFields.innerHTML = `
        <div class="form-group" style="text-align:left; margin-bottom:0;">
          <label class="form-label">Sala / Laboratório <span style="color:red">*</span></label>
          <select id="er-sala" class="form-control" required>
            <option value="">Selecione a sala...</option>
            ${SALAS.map(s => `<option value="${s}">${s}</option>`).join('')}
            <option value="__outra__">✏️ Outro local (digitar)...</option>
          </select>
          <input type="text" id="er-sala-outra" class="form-control hidden" placeholder="Digite o local do empréstimo..." style="margin-top:0.5rem;">
        </div>
      `;
      const selSala = document.getElementById('er-sala');
      const inputOutra = document.getElementById('er-sala-outra');
      selSala.addEventListener('change', () => {
        inputOutra.classList.toggle('hidden', selSala.value !== '__outra__');
        if (selSala.value === '__outra__') inputOutra.focus();
      });
    } else if (tipo === 'cedido') {
      funcLabel.style.borderColor = 'var(--primary-blue)';
      dynFields.innerHTML = `
        <div style="display:flex; gap:0.75rem;">
          <div class="form-group" style="text-align:left; flex:1; margin-bottom:0;">
            <label class="form-label">Nome do Funcionário <span style="color:red">*</span></label>
            <input type="text" id="er-funcionario" class="form-control" placeholder="Nome completo...">
          </div>
          <div class="form-group" style="text-align:left; flex:1; margin-bottom:0;">
            <label class="form-label">Setor <span style="color:red">*</span></label>
            <input type="text" id="er-setor" class="form-control" placeholder="Ex: Biblioteca...">
          </div>
        </div>
      `;
    }
  }

  radios.forEach(r => {
    r.addEventListener('change', () => renderDynFields(r.value));
  });

  // Trigger initial render for default selected
  const checked = document.querySelector('input[name="er-destino"]:checked');
  if (checked) renderDynFields(checked.value);
}

function setupERIdValidation() {
  const input = document.getElementById('er-id');
  const feedback = document.getElementById('er-id-feedback');
  if (!input || !feedback) return;

  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const val = input.value.trim();
      if (!val) { feedback.style.display = 'none'; return; }

      const exists = notebooksDB.find(n => n.id.toLowerCase() === val.toLowerCase());
      if (exists) {
        feedback.style.display = 'block';
        feedback.style.color = '#ef4444';
        feedback.innerHTML = `⚠️ Já existe um item com o ID <strong>"${val}"</strong>. Escolha um identificador diferente.`;
        input.style.borderColor = '#ef4444';
      } else {
        feedback.style.display = 'block';
        feedback.style.color = '#22c55e';
        feedback.innerHTML = `✅ ID disponível — Item temporário: <strong>"${val}"</strong>`;
        input.style.borderColor = '#22c55e';
      }
    }, 350);
  });
}

window.abrirEmprestimoRapido = function() {
  const modal = document.getElementById('modal-emprestimo-rapido');
  if (!modal) return;

  // Reset form
  const form = document.getElementById('form-emprestimo-rapido');
  if (form) form.reset();

  // Clear dynamic fields
  const dynFields = document.getElementById('er-dynamic-fields');
  if (dynFields) dynFields.innerHTML = '';

  // Clear feedback
  const feedback = document.getElementById('er-id-feedback');
  if (feedback) { feedback.style.display = 'none'; }
  const idInput = document.getElementById('er-id');
  if (idInput) idInput.style.borderColor = '';

  // Limpa itens adicionais
  const extraIds = document.getElementById('er-extra-ids');
  if (extraIds) extraIds.innerHTML = '';
  const addBtn = document.getElementById('er-add-item');
  if (addBtn && !addBtn._erSetup) {
    addBtn._erSetup = true;
    addBtn.addEventListener('click', adicionarERItemExtra);
  }

  // Reset submit button
  const submitText = document.getElementById('er-submit-text');
  const submitBtn = document.getElementById('er-submit-btn');
  if (submitText) submitText.textContent = '⚡ Emprestar';
  if (submitBtn) submitBtn.disabled = false;

  modal.classList.add('active');

  // Setup interactions
  setupERDestinoToggle();
  setupERIdValidation();

  // Pre-select Sala
  const salaRadio = document.getElementById('er-dest-sala');
  if (salaRadio) {
    salaRadio.checked = true;
    salaRadio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Focus first field
  setTimeout(() => { if (idInput) idInput.focus(); }, 100);
};

// Adiciona mais um campo de identificador no Empréstimo Rápido
function adicionarERItemExtra() {
  const container = document.getElementById('er-extra-ids');
  if (!container) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:0.4rem; margin-top:0.5rem;';
  row.innerHTML = `
    <input type="text" class="form-control er-extra-id" placeholder="Outro item..." autocomplete="off" style="padding: 0.6rem 0.8rem; font-size: 0.88rem; height: 38px; border-radius: 8px; flex:1;">
    <button type="button" class="btn btn-secondary" title="Remover item" style="height:38px; width:38px; padding:0; border-radius:8px; flex-shrink:0;">✕</button>
  `;
  const input = row.querySelector('input');
  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    input.style.borderColor = val && notebooksDB.some(n => n.id.toLowerCase() === val) ? '#ef4444' : '';
  });
  row.querySelector('button').addEventListener('click', () => row.remove());
  container.appendChild(row);
  input.focus();
}

window.fecharEmprestimoRapido = function() {
  document.getElementById('modal-emprestimo-rapido').classList.remove('active');
};

// Form submit handler for Empréstimo Rápido
document.addEventListener('DOMContentLoaded', () => {
  // This is called after DOMContentLoaded for safety, but the event is hoisted below
});

// We hook into the submit from initDashboard since DOMContentLoaded may have passed
function setupEmprestimoRapidoForm() {
  const form = document.getElementById('form-emprestimo-rapido');
  if (!form || form._erSetup) return;
  form._erSetup = true;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('er-id').value.trim();
    const extras = Array.from(document.querySelectorAll('.er-extra-id'))
      .map(i => i.value.trim())
      .filter(Boolean);
    const ids = [id, ...extras];
    const tipo = 'Notebook'; // Default to Notebook to avoid issues, or 'Outros'
    const requerente = document.getElementById('er-requerente').value.trim();
    const observacao = document.getElementById('er-observacao').value.trim();
    const destinoRadio = document.querySelector('input[name="er-destino"]:checked');

    // Validações
    if (!id || !requerente || !destinoRadio) {
      alert('Preencha todos os campos obrigatórios.');
      return;
    }

    const vistos = new Set();
    for (const itemId of ids) {
      const key = itemId.toLowerCase();
      if (vistos.has(key)) {
        alert(`O item "${itemId}" foi informado mais de uma vez.`);
        return;
      }
      vistos.add(key);
      if (notebooksDB.find(n => n.id.toLowerCase() === key)) {
        alert(`Já existe um item com o ID "${itemId}". Por favor, escolha outro identificador.`);
        return;
      }
    }

    const destino = destinoRadio.value;
    let extraFields = {};

    if (destino === 'sala') {
      let sala = document.getElementById('er-sala')?.value;
      if (sala === '__outra__') sala = document.getElementById('er-sala-outra')?.value.trim();
      if (!sala) { alert('Selecione ou digite a sala.'); return; }
      extraFields = { status: 'emprestado', sala, local: 'T.I.' };
    } else if (destino === 'cedido') {
      const funcionario = document.getElementById('er-funcionario')?.value.trim();
      const setor = document.getElementById('er-setor')?.value.trim();
      if (!funcionario || !setor) { alert('Preencha o nome do funcionário e o setor.'); return; }
      extraFields = { status: 'cedido', funcionario, setor, local: 'T.I.' };
    }

    // Disable button
    const submitBtn = document.getElementById('er-submit-btn');
    const submitText = document.getElementById('er-submit-text');
    submitText.textContent = 'Processando...';
    submitBtn.disabled = true;

    const userName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Desconhecido';
    const now = new Date().toISOString();
    const grupoId = ids.length > 1 ? novoGrupoId() : '';

    const buildItem = (id) => ({
      id,
      tipo,
      temQrCode: false,
      temporario: true, // Flag as temporary item
      grupoId,
      responsavel: userName,
      requerente,
      observacao,
      updatedAt: now,
      ...extraFields,
      historico: [{
        status: extraFields.status,
        responsavel: userName,
        requerente,
        observacao,
        updatedAt: now,
        ...(extraFields.sala ? { sala: extraFields.sala } : {}),
        ...(extraFields.funcionario ? { funcionario: extraFields.funcionario, setor: extraFields.setor } : {}),
        local: 'T.I.'
      }]
    });

    const salvos = [];
    try {
      for (const itemId of ids) {
        await apiFetch(`/emprestimos/${itemId}`, {
          method: 'PUT',
          body: JSON.stringify(buildItem(itemId))
        });
        salvos.push(itemId);
      }

      window.fecharEmprestimoRapido();
      await loadNotebooks(true);
      applyFilters();

      // Show success feedback
      const successMsg = document.createElement('div');
      successMsg.style.cssText = `
        position:fixed; bottom:24px; right:24px; z-index:9999;
        background:linear-gradient(135deg,#065f46,#047857); color:white;
        padding:1rem 1.5rem; border-radius:12px;
        font-weight:700; font-size:0.9rem; box-shadow:0 8px 24px rgba(0,0,0,0.4);
        display:flex; align-items:center; gap:0.5rem;
        animation: slideInRight 0.3s ease;
      `;
      successMsg.innerHTML = ids.length === 1
        ? `<span>✅</span><span>Empréstimo temporário de <strong>${esc(id)}</strong> realizado com sucesso!</span>`
        : `<span>✅</span><span><strong>${ids.length} itens</strong> emprestados com sucesso!</span>`;
      document.body.appendChild(successMsg);
      setTimeout(() => successMsg.remove(), 4000);

    } catch (err) {
      console.error(err);
      const parcial = salvos.length ? `\n\nJá foram emprestados: ${salvos.join(', ')}` : '';
      alert('Erro ao processar Empréstimo Rápido: ' + err.message + parcial);
      if (salvos.length) { await loadNotebooks(true); applyFilters(); }
    } finally {
      if (submitText) submitText.textContent = '⚡ Emprestar';
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function applyFilters() {
  const s   = document.getElementById('search-input').value.toLowerCase();
  const st  = document.getElementById('filter-status').value;
  const cat = document.getElementById('filter-categoria').value;
  const loc = document.getElementById('filter-local').value;
  const sa  = document.getElementById('filter-sala').value.trim() || 'Todos';
  const filtered = notebooksDB.filter(n => {
    if (s && !n.id.toLowerCase().includes(s)) return false;
    
    // Filtro por status ou temporário
    if (st !== 'Todos') {
      if (st === 'temporario') {
        if (!n.temporario) return false;
      } else {
        if (n.status !== st || n.temporario) return false; // Não mostra temporário nos normais se filtrado por status
      }
    }
    
    if (cat !== 'Todos' && n.tipo !== cat) return false;
    if (loc !== 'Todos') { if (n.status !== 'guardado' || n.local !== loc) return false; }
    if (sa !== 'Todos')  { if (n.status !== 'emprestado' || n.sala !== sa) return false; }
    return true;
  });
  renderGrid(filtered);
}

function renderGrid(list) {
  const grid = document.getElementById('notebook-grid');
  grid.innerHTML = '';

  // Stats filtrados pela categoria selecionada
  const selectedCat = document.getElementById('filter-categoria') ? document.getElementById('filter-categoria').value : 'Todos';
  const statsList = selectedCat === 'Todos'
    ? notebooksDB
    : notebooksDB.filter(n => n.tipo === selectedCat);

  const count = { guardado:0, emprestado:0, cedido:0, reservado:0, temporario:0 };
  statsList.forEach(n => {
    if (n.temporario) {
      count.temporario++;
    } else {
      if(count[n.status] !== undefined) count[n.status]++;
    }
  });
  
  // Atualiza labels dos cards com o nome da categoria para ficar distinto
  const labels = {
    Todos: 'Total',
    guardado: 'Disponíveis',
    emprestado: 'Emprestados',
    cedido: 'Cedidos',
    reservado: 'Reservados',
    temporario: 'Temporários'
  };
  
  document.querySelectorAll('.status-summary .stat-item').forEach(item => {
    const filterVal = item.dataset.filter; // "Todos", "guardado", "emprestado", "cedido", "reservado", "temporario"
    const lblEl = item.querySelector('.stat-lbl');
    if (lblEl && filterVal) {
      const baseText = labels[filterVal] || 'Status';
      lblEl.textContent = selectedCat === 'Todos' ? baseText : `${baseText} (${selectedCat})`;
    }

    // Remove qualquer breakdown residual do design anterior
    const existing = item.querySelector('.stat-breakdown');
    if (existing) existing.remove();
  });

  const elT = document.getElementById('stat-total');
  const elG = document.getElementById('stat-guardado');
  const elE = document.getElementById('stat-emprestado');
  const elC = document.getElementById('stat-cedido');
  const elR = document.getElementById('stat-reservado');
  const elTemp = document.getElementById('stat-temporario');

  if(elT) elT.textContent = statsList.length;
  if(elG) elG.textContent = count.guardado;
  if(elE) elE.textContent = count.emprestado;
  if(elC) elC.textContent = count.cedido;
  if(elR) elR.textContent = count.reservado;
  if(elTemp) elTemp.textContent = count.temporario;
  
  const elGC = document.getElementById('grid-count');
  if(elGC) elGC.textContent = `${list.length} ite${list.length===1?'m':'ns'}`;

  if (!list.length) {
    grid.innerHTML = `<p style="color:var(--text-muted);padding:2rem;grid-column:1/-1;text-align:center;">Nenhum equipamento encontrado.</p>`;
    return;
  }

  // Itens emprestados juntos (mesmo grupoId) viram um card só
  const grupos = {};
  list.forEach(n => {
    if (n.grupoId && (n.status === 'emprestado' || n.status === 'cedido')) (grupos[n.grupoId] ||= []).push(n);
  });

  // Separa em seções: grupos primeiro, depois uma por categoria (na ordem
  // das abas, Notebook primeiro) e os temporários por último
  const secoes = new Map();
  const secao = (chave, titulo, icone) => {
    if (!secoes.has(chave)) secoes.set(chave, { titulo, icone, blocos: [], itens: [] });
    return secoes.get(chave);
  };
  const gruposVistos = new Set();
  list.forEach(n => {
    const grupo = n.grupoId && grupos[n.grupoId];
    if (grupo && grupo.length > 1) {
      if (gruposVistos.has(n.grupoId)) return;
      gruposVistos.add(n.grupoId);
      const s = secao('__grupos', 'Empréstimos em grupo', iconeHtml('caixa', 'inline'));
      s.blocos.push({ grupo, nome: grupo[0].id });
      s.itens.push(...grupo);
      return;
    }
    const s = n.temporario
      ? secao('__temp', 'Temporários', iconeHtml('caixa', 'inline'))
      : secao('cat:' + (n.tipo || 'Notebook'), n.tipo || 'Notebook', iconeCategoria(n.tipo || 'Notebook'));
    s.blocos.push({ item: n, nome: n.id });
    s.itens.push(n);
  });

  const ordemCat = (titulo) => {
    const i = categorias.findIndex(c => c.toLowerCase() === titulo.toLowerCase());
    return i < 0 ? 999 : i;
  };
  const chaves = [...secoes.keys()].sort((a, b) => {
    const peso = k => k === '__grupos' ? -1 : k === '__temp' ? 10000 : ordemCat(secoes.get(k).titulo);
    return peso(a) - peso(b) || secoes.get(a).titulo.localeCompare(secoes.get(b).titulo, 'pt-BR');
  });
  const ordemNatural = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true, sensitivity: 'base' });

  chaves.forEach(chave => {
    const s = secoes.get(chave);
    const fora = s.itens.filter(i => i.status === 'emprestado' || i.status === 'cedido').length;
    const reservados = s.itens.filter(i => i.status === 'reservado').length;
    const resumo = [
      chave !== '__grupos' && fora ? `${fora} fora` : '',
      reservados ? `${reservados} reservado${reservados > 1 ? 's' : ''}` : ''
    ].filter(Boolean).join(' · ');

    const cab = document.createElement('div');
    cab.className = 'grid-secao';
    cab.innerHTML = `
      <span class="grid-secao-titulo">${s.icone} ${esc(s.titulo)}</span>
      <span class="grid-secao-contagem">${chave === '__grupos' ? `${s.blocos.length} grupo${s.blocos.length > 1 ? 's' : ''}` : s.itens.length}</span>
      ${resumo ? `<span class="grid-secao-resumo">${resumo}</span>` : ''}`;
    grid.appendChild(cab);

    s.blocos.sort(ordemNatural).forEach(b => grid.appendChild(b.grupo ? renderGrupoCard(b.grupo) : criarCardItem(b.item)));
  });
}

function criarCardItem(n) {
    const card = document.createElement('div');
    card.className = 'notebook-card';
    card.dataset.id = n.id;
    card.style.cursor = 'pointer';

    const statusChave = n.temporario ? 'temporario' : n.status;
    const statusTexto = n.temporario ? 'Temporário' : (ROTULO_STATUS[n.status] || n.status);
    const tipoTexto = n.temporario ? 'Item temporário' : (n.tipo || 'Notebook');

    const qrBtnHtml = n.temQrCode !== false
      ? `<button class="card-btn btn-qr action-execute" data-id="${esc(n.id)}" title="Gerar etiqueta QR">${UI_ICONE.qr} QR</button>`
      : `<button class="card-btn action-execute" disabled title="Item configurado sem QR Code">${UI_ICONE.qr} Sem QR</button>`;

    card.innerHTML = `
      <div class="card-header">
        <div class="card-titulo">
          ${iconeItem(n)}
          <div class="card-titulo-texto">
            <span class="card-id" title="${esc(n.id)}">${esc(n.id)}</span>
            <span class="card-tipo">${esc(tipoTexto)}</span>
          </div>
        </div>
        <div class="card-header-acoes">
          <span class="badge badge-${statusChave}">${esc(statusTexto)}</span>
        </div>
      </div>

      <div class="card-detail">
        <div class="card-detail-linha">${linhaDestino(n)}</div>
        ${n.observacao ? `<div class="card-obs">${esc(n.observacao)}</div>` : ''}
      </div>

      ${n.comentarioFixado ? `
      <div class="card-pinned-comment" data-id="${esc(n.id)}" title="Editar comentário fixado">
        ${UI_ICONE.pin}
        <span>${esc(n.comentarioFixado)}</span>
      </div>` : ''}

      <div class="card-footer">
        <span title="Última movimentação">${UI_ICONE.relogio} ${dataCurta(n.updatedAt)}</span>
        <span title="Responsável">${UI_ICONE.pessoa} ${esc(n.responsavel || '---')}</span>
      </div>

      <div class="card-actions">
        ${n.temporario ? `
          <button class="card-btn sucesso btn-devolver action-execute" data-id="${esc(n.id)}">${UI_ICONE.check} Devolvido</button>
        ` : `
          <a href="movimentar.html?id=${encodeURIComponent(n.id)}" class="card-btn principal action-execute">${UI_ICONE.mover} Movimentar</a>
          ${qrBtnHtml}
          <button class="icon-btn btn-pin action-execute ${n.comentarioFixado ? 'ativo' : ''}" data-id="${esc(n.id)}" title="${n.comentarioFixado ? 'Editar/remover comentário' : 'Fixar comentário'}">${UI_ICONE.pin}</button>
          <button class="icon-btn btn-lock action-execute ${n.status === 'reservado' ? 'active' : ''}" data-id="${esc(n.id)}" title="${n.status === 'reservado' ? 'Liberar reserva' : 'Reservar'}">${UI_ICONE.cadeado}</button>
        `}
      </div>
    `;
    return card;
}

// ---- Peças visuais dos cards ----
const ROTULO_STATUS = { guardado: 'Disponível', emprestado: 'Emprestado', cedido: 'Cedido', reservado: 'Reservado' };

const svgUi = (d, tam = 14) => `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const UI_ICONE = {
  sala:    svgUi('<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>'),
  pessoa:  svgUi('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  cadeado: svgUi('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 16),
  local:   svgUi('<path d="M21 8v13H3V8M1 3h22v5H1z"/><path d="M10 12h4"/>'),
  relogio: svgUi('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 12),
  pin:     svgUi('<path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.89A.5.5 0 0 0 6.36 14h11.28a.5.5 0 0 0 .25-.56l-1.78-.89a2 2 0 0 1-1.11-1.79V4h-6v6.76zM6 4h12"/>', 15),
  qr:      svgUi('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
  mover:   svgUi('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  check:   svgUi('<polyline points="20 6 9 17 4 12"/>'),
};

function dataCurta(iso) {
  if (!iso) return '---';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ', ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function linhaDestino(n) {
  // não repete "Sala" quando o nome já começa com isso ("Sala 07")
  const sala = /^sala\b/i.test((n.sala || '').trim()) ? n.sala.trim() : `Sala ${n.sala || ''}`;
  if (n.status === 'emprestado') return `${UI_ICONE.sala}<span>${esc(sala)}${n.requerente ? ` · ${esc(n.requerente)}` : ''}</span>`;
  if (n.status === 'cedido')     return `${UI_ICONE.pessoa}<span>${esc(n.funcionario)}${n.setor ? ` · ${esc(n.setor)}` : ''}</span>`;
  if (n.status === 'reservado')  return `${UI_ICONE.cadeado}<span>${n.requerente ? `Para ${esc(n.requerente)}` : 'Reservado'}${n.dataDevolucao ? ` · até ${n.dataDevolucao.split('-').reverse().join('/')}` : ''}</span>`;
  return `${UI_ICONE.local}<span>Guardado · ${esc(n.local || 'T.I.')}</span>`;
}

function renderGrupoCard(itens) {
  const n = itens[0];
  const card = document.createElement('div');
  card.className = 'notebook-card';

  card.innerHTML = `
    <div class="card-header">
      <div class="card-titulo">
        ${iconeHtml('caixa')}
        <div class="card-titulo-texto">
          <span class="card-id">${itens.length} itens juntos</span>
          <span class="card-tipo">Empréstimo em grupo</span>
        </div>
      </div>
      <div class="card-header-acoes">
        <span class="badge badge-${n.status}">${esc(ROTULO_STATUS[n.status] || n.status)}</span>
      </div>
    </div>

    <div class="card-detail">
      <div class="card-detail-linha">${linhaDestino(n)}</div>
      ${n.observacao ? `<div class="card-obs">${esc(n.observacao)}</div>` : ''}
    </div>

    <div class="grupo-itens">
      ${itens.map(i => `
        <div class="grupo-item">
          ${i.temporario
            ? `<span>${iconeItem(i, 'mini')}<strong>${esc(i.id)}</strong><small>temporário</small></span>`
            : `<a href="movimentar.html?id=${encodeURIComponent(i.id)}" title="Movimentar só este item">${iconeItem(i, 'mini')}<strong>${esc(i.id)}</strong><small>${esc(i.tipo || '')}</small></a>`}
          <button class="card-btn mini btn-devolver action-execute" data-id="${esc(i.id)}" title="Devolver só este item">Devolver</button>
        </div>`).join('')}
    </div>

    <div class="card-footer">
      <span title="Última movimentação">${UI_ICONE.relogio} ${dataCurta(n.updatedAt)}</span>
      <span title="Responsável">${UI_ICONE.pessoa} ${esc(n.responsavel || '---')}</span>
    </div>

    <div class="card-actions">
      <button class="card-btn sucesso btn-devolver-grupo action-execute" data-grupo="${esc(n.grupoId)}">${UI_ICONE.check} Devolver tudo</button>
    </div>
  `;
  return card;
}

// Carrega uma lib externa sob demanda (só quando o recurso é realmente usado,
// em vez de bloquear o carregamento inicial da página com <script> no <head>).
function loadScriptOnce(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(s);
  });
}

async function abrirQR(id) {
  if (typeof QRCode === 'undefined') {
    await loadScriptOnce('https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs@gh-pages/qrcode.min.js');
  }

  const label = document.getElementById('qr-label-name');
  if (label) label.textContent = id;
  const container = document.getElementById('qr-code-canvas');
  container.innerHTML = '';
  
  let base = window.location.href.split('emprestimo/')[0];
  if (window.location.hostname.endsWith('vercel.app')) {
    base = 'https://orbita-fatec-ti.vercel.app/';
  }
  
  const url  = `${base}emprestimo/movimentar.html?id=${id}`;
  new QRCode(container, { text:url, width:200, height:200, correctLevel: QRCode.CorrectLevel.H });
  document.getElementById('qr-modal').classList.add('active');
}

// ================================================================
//  MOVIMENTAR (MOBILE FORM)
// ================================================================
function initMovimentar() {
  const mainEl = document.getElementById('emprestimo-main-section');
  mainEl.classList.remove('hidden');

  const urlParams  = new URLSearchParams(window.location.search);
  const notebookId = urlParams.get('id') || notebooksDB[0]?.id;
  const isManage   = urlParams.get('manage') === 'true';

  let noteObj = notebooksDB.find(n => n.id === notebookId) || notebooksDB[0];

  function updateHeader(n) {
    if (!n) return;
    const nameEl = document.getElementById('notebook-name');
    const badgeEl = document.getElementById('current-status-badge');
    const updateEl = document.getElementById('last-update');
    const alertBox = document.getElementById('reservation-alert');

    if (nameEl) nameEl.innerHTML = `<span style="display:inline-flex; align-items:center; gap:0.5rem;">${iconeItem(n, 'inline')} ${esc(n.id)}</span>`;
    if (badgeEl) {
      badgeEl.textContent = n.status.toUpperCase();
      badgeEl.className = `badge badge-${n.status}`;
    }
    
    let extra = '';
    if (n.status==='emprestado') extra = `(${n.sala})`;
    if (n.status==='cedido')     extra = `(${n.funcionario})`;
    if (n.status==='reservado')  extra = `(Reservado)`;
    
    const updateStr = n.updatedAt ? new Date(n.updatedAt).toLocaleDateString('pt-BR') : '---';
    if (updateEl) updateEl.textContent = `${updateStr} ${extra}`;

    if (alertBox) {
      if (n.status === 'reservado') {
        alertBox.classList.remove('hidden');
        const msgEl = document.getElementById('reservation-msg');
        if (msgEl) msgEl.textContent = n.observacao || 'Reservado pela T.I.';
        
        const modal = document.getElementById('reserved-locked-modal');
        if (modal) {
           const lMsg = document.getElementById('locked-reservation-msg');
           if (lMsg) lMsg.textContent = n.observacao || 'Sem motivo especificado.';
           modal.classList.add('active');
        }
      } else {
        alertBox.classList.add('hidden');
        const modal = document.getElementById('reserved-locked-modal');
        if (modal) modal.classList.remove('active');
      }
    }
  }

  updateHeader(noteObj);

  // Polling listener via API para o equipamento atual (Reduzido para economizar recursos do servidor)
  setInterval(async () => {
    if (document.hidden) return; // Ignorar se a aba estiver oculta/inativa
    try {
      const data = await apiFetch(`/emprestimos/${notebookId}`);
      noteObj = data; 
      updateHeader(noteObj);
    } catch(err) {}
  }, 120000);

  // Dynamic fields
  const radios   = document.querySelectorAll('input[name="status"]');
  const dynFields= document.getElementById('dynamic-fields');

  function renderFields(status) {
    dynFields.innerHTML = '';
    if (status==='guardado') {
      dynFields.innerHTML=`<div class="form-group"><label class="form-label">Local <span style="color:red">*</span></label><select class="form-control" name="local" required><option value="" disabled selected>Selecione</option><option>Carrinho</option><option>T.I.</option></select></div>`;
    } else if (status==='emprestado') {
      const opts = SALAS.map(s=>`<option value="${s}">`).join('');
      dynFields.innerHTML=`
        <div class="form-group">
          <label class="form-label">Sala <span style="color:red">*</span></label>
          <input type="text" class="form-control" name="sala" list="salas-list" placeholder="Busque a sala..." required autocomplete="off">
          <datalist id="salas-list">${opts}</datalist>
        </div>
        <div class="form-group">
          <label class="form-label">Nome do Requerente <span style="color:red">*</span></label>
          <input type="text" class="form-control" name="requerente" placeholder="Quem está retirando..." required>
        </div>
      `;
    } else if (status==='cedido') {
      dynFields.innerHTML=`<div class="form-group"><label class="form-label">Funcionário <span style="color:red">*</span></label><input type="text" class="form-control" name="funcionario" placeholder="Ex: João da Silva" required></div><div class="form-group"><label class="form-label">Setor <span style="color:red">*</span></label><input type="text" class="form-control" name="setor" placeholder="Ex: Secretaria" required></div>`;
    }
  }

  // Pre-select current status
  const cur = Array.from(radios).find(r => r.value === noteObj?.status);
  if (cur) cur.checked = true;
  renderFields(noteObj?.status || 'guardado');

  // Pre-fill commentary and observation fields
  const obsField = document.getElementById('observacao');
  if (obsField) obsField.value = noteObj?.observacao || '';
  const cFixField = document.getElementById('comentario-fixado');
  if (cFixField) cFixField.value = noteObj?.comentarioFixado || '';

  // Emprestar mais itens junto — lista de itens disponíveis (guardados) para seleção múltipla
  const multiBox   = document.getElementById('multi-itens-box');
  const multiList  = document.getElementById('multi-itens-list');
  const multiBusca = document.getElementById('multi-itens-busca');
  const multiCount = document.getElementById('multi-itens-count');
  const multiCats  = document.getElementById('multi-itens-cats');
  const multiChips = document.getElementById('multi-itens-selecionados');
  const multiSel   = new Set();
  let multiCat     = 'Todos';
  const tipoDe     = n => (n.tipo || 'Notebook').trim();

  function renderMultiList() {
    if (!multiList) return;
    const termo = (multiBusca?.value || '').trim().toLowerCase();
    const base = notebooksDB.filter(n => n.id !== noteObj?.id && n.status === 'guardado' && !n.temporario);

    // Botões de categoria (Todos / Notebook / Passador / Caixa de Som ...) com contagem de disponíveis
    if (multiCats) {
      const cats = [...new Set(base.map(tipoDe))].sort((a, b) =>
        a.toLowerCase() === 'notebook' ? -1 : b.toLowerCase() === 'notebook' ? 1 : a.localeCompare(b));
      if (multiCat !== 'Todos' && !cats.includes(multiCat)) multiCat = 'Todos';
      multiCats.innerHTML = ['Todos', ...cats].map(c => {
        const qtd = c === 'Todos' ? base.length : base.filter(n => tipoDe(n) === c).length;
        const ativo = c === multiCat;
        return `<button type="button" data-cat="${esc(c)}" style="padding:0.3rem 0.65rem; border-radius:999px; font-size:0.78rem; font-weight:700; cursor:pointer; border:1.5px solid ${ativo ? 'var(--primary-blue)' : 'var(--border-color)'}; background:${ativo ? 'var(--primary-blue)' : 'transparent'}; color:${ativo ? 'white' : 'var(--text-secondary)'}; display:inline-flex; align-items:center; gap:0.3rem;">${c === 'Todos' ? '' : iconeCategoria(c)}${esc(c)} (${qtd})</button>`;
      }).join('');
    }

    // Lista agrupada por categoria
    const disponiveis = base.filter(n =>
      (multiCat === 'Todos' || tipoDe(n) === multiCat) &&
      (!termo || n.id.toLowerCase().includes(termo) || tipoDe(n).toLowerCase().includes(termo))
    );
    const grupos = {};
    disponiveis.forEach(n => { (grupos[tipoDe(n)] ||= []).push(n); });
    multiList.innerHTML = disponiveis.length
      ? Object.keys(grupos).sort().map(cat => `
          <div style="font-size:0.72rem; font-weight:800; text-transform:uppercase; color:var(--text-secondary); padding:0.5rem 0.25rem 0.15rem; letter-spacing:0.03em; display:flex; align-items:center; gap:0.35rem;">${iconeCategoria(cat)} ${esc(cat)}</div>
          ${grupos[cat].map(n => `
            <label style="display:flex; align-items:center; gap:0.5rem; padding:0.4rem 0.25rem; cursor:pointer; font-size:0.9rem;">
              <input type="checkbox" value="${esc(n.id)}" ${multiSel.has(n.id) ? 'checked' : ''}>
              <span style="display:inline-flex; align-items:center; gap:0.45rem;">${iconeItem(n, 'mini')} <strong>${esc(n.id)}</strong> <span style="color:var(--text-secondary); font-size:0.8rem;">${esc(n.local || '')}</span></span>
            </label>`).join('')}`).join('')
      : `<p style="color:var(--text-muted); font-size:0.85rem; padding:0.5rem 0; margin:0;">Nenhum item disponível.</p>`;

    // Resumo do que vai junto (ex: Notebook + Passador + Caixa de Som)
    if (multiChips) {
      multiChips.innerHTML = Array.from(multiSel).map(id => {
        const n = notebooksDB.find(x => x.id === id);
        return `<span style="display:inline-flex; align-items:center; gap:0.3rem; padding:0.25rem 0.55rem; border-radius:999px; background:rgba(15,78,184,0.08); color:var(--primary-blue); font-size:0.78rem; font-weight:700;">${iconeItem(n, 'inline')} ${esc(id)}${n ? ` · ${esc(tipoDe(n))}` : ''}<button type="button" data-remover="${esc(id)}" title="Remover" style="background:none; border:none; color:inherit; cursor:pointer; padding:0; font-size:0.85rem; line-height:1;">✕</button></span>`;
      }).join('');
    }
    if (multiCount) multiCount.textContent = multiSel.size ? `${multiSel.size} ite${multiSel.size === 1 ? 'm' : 'ns'} a mais selecionado${multiSel.size === 1 ? '' : 's'}` : '';
  }

  multiCats?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cat]');
    if (!b) return;
    multiCat = b.dataset.cat;
    renderMultiList();
  });
  multiChips?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-remover]');
    if (!b) return;
    multiSel.delete(b.dataset.remover);
    renderMultiList();
  });

  function toggleMultiBox(status) {
    if (!multiBox) return;
    const mostrar = status === 'emprestado' || status === 'cedido';
    multiBox.classList.toggle('hidden', !mostrar);
    if (mostrar) renderMultiList();
  }

  multiList?.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) multiSel.add(e.target.value); else multiSel.delete(e.target.value);
    renderMultiList();
  });
  multiBusca?.addEventListener('input', renderMultiList);

  toggleMultiBox(noteObj?.status);
  radios.forEach(r => r.addEventListener('change', e => {
    renderFields(e.target.value);
    toggleMultiBox(e.target.value);
  }));

  // Submit
  document.getElementById('movimentacao-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.textContent = 'Salvando...'; btn.disabled = true;

    const fd      = new FormData(e.target);
    const status  = fd.get('status');
    const userName= currentUser.displayName || currentUser.email.split('@')[0];

    noteObj.status      = status;
    noteObj.responsavel = userName;
    noteObj.updatedAt   = new Date().toISOString();
    noteObj.observacao  = fd.get('observacao') || '';
    noteObj.comentarioFixado = fd.get('comentarioFixado') || '';
    noteObj.local=''; noteObj.sala=''; noteObj.funcionario=''; noteObj.setor=''; noteObj.requerente='';

    let sumHtml = `Status: <b>${status.charAt(0).toUpperCase()+status.slice(1)}</b><br>`;
    if (status==='guardado')   { noteObj.local=fd.get('local'); sumHtml+=`Local: <b>${noteObj.local}</b>`; }
    if (status==='emprestado') { 
      noteObj.sala=fd.get('sala'); 
      noteObj.requerente=fd.get('requerente'); 
      sumHtml+=`Sala: <b>${noteObj.sala}</b><br>Requerente: <b>${noteObj.requerente}</b>`; 
    }
    if (status==='cedido')     { noteObj.funcionario=fd.get('funcionario'); noteObj.setor=fd.get('setor'); sumHtml+=`Funcionário: <b>${noteObj.funcionario}</b><br>Setor: <b>${noteObj.setor}</b>`; }

    // Itens adicionais selecionados recebem o mesmo destino/requerente e formam
    // um grupo (aparecem num card só no painel, com "Devolver tudo")
    const extras = (status === 'emprestado' || status === 'cedido') ? Array.from(multiSel) : [];
    noteObj.grupoId = extras.length ? novoGrupoId() : '';

    await apiFetch(`/emprestimos/${noteObj.id}`, { method: 'PUT', body: JSON.stringify(noteObj) });

    const salvos = [noteObj.id];
    try {
      for (const extraId of extras) {
        const extra = notebooksDB.find(n => n.id === extraId);
        if (!extra) continue;
        const atualizado = {
          ...extra,
          status,
          responsavel: noteObj.responsavel,
          updatedAt: noteObj.updatedAt,
          observacao: noteObj.observacao,
          local: noteObj.local, sala: noteObj.sala,
          funcionario: noteObj.funcionario, setor: noteObj.setor,
          requerente: noteObj.requerente,
          grupoId: noteObj.grupoId
        };
        await apiFetch(`/emprestimos/${extraId}`, { method: 'PUT', body: JSON.stringify(atualizado) });
        salvos.push(extraId);
      }
    } catch (err) {
      console.error(err);
      alert(`Erro ao movimentar itens adicionais: ${err.message}\n\nJá registrados: ${salvos.join(', ')}`);
    }
    if (salvos.length > 1) sumHtml += `<br>Itens: <b>${salvos.map(esc).join(', ')}</b>`;

    btn.textContent='Confirmar Mudança'; btn.disabled=false;

    const mTitle = document.getElementById('modal-title');
    const mDesc  = document.getElementById('modal-desc');
    const mSum   = document.getElementById('modal-summary');

    if (mTitle) mTitle.textContent = 'Atualizado!';
    if (mDesc)  mDesc.textContent  = salvos.length > 1 ? `${salvos.length} itens registrados com sucesso.` : `${noteObj.id} registrado com sucesso.`;
    if (mSum)   mSum.innerHTML     = sumHtml;

    document.getElementById('success-modal').classList.add('active');
  });

  // Excluir equipamento (remove o registro inteiro do banco de dados)
  const btnExcluir = document.getElementById('btn-excluir-emprestimo');
  if (btnExcluir) {
    btnExcluir.addEventListener('click', async () => {
      if (!confirm(`Excluir definitivamente o equipamento "${noteObj.id}"?\nIsso remove o registro e todo o histórico. Essa ação não tem volta.`)) return;

      btnExcluir.textContent = 'Excluindo...';
      btnExcluir.disabled = true;
      try {
        await apiFetch(`/emprestimos/${noteObj.id}`, { method: 'DELETE' });
        window.location.href = '/emprestimo/index.html';
      } catch (err) {
        alert('Erro ao excluir: ' + err.message);
        btnExcluir.textContent = 'Excluir Equipamento';
        btnExcluir.disabled = false;
      }
    });
  }
}

// ----------------------------------------------------------------
//  Scanner (global — used in both pages)
// ----------------------------------------------------------------
let scannerInstance = null;

window.abrirScanner = async function() {
  document.getElementById('success-modal')?.classList.remove('active');
  document.getElementById('reserved-locked-modal')?.classList.remove('active');
  document.getElementById('scanner-modal').classList.add('active');

  if (typeof Html5Qrcode === 'undefined') {
    await loadScriptOnce('https://unpkg.com/html5-qrcode');
  }

  scannerInstance = new Html5Qrcode('reader');
  scannerInstance.start(
    { facingMode:'environment' },
    { fps:10, qrbox:{ width:240, height:240 } },
    (decoded) => {
      let itemId = '';
      try {
        const url = new URL(decoded);
        itemId = url.searchParams.get('id');
      } catch (e) {
        const queryMatch = decoded.match(/[?&]id=([^&]+)/);
        if (queryMatch) {
          itemId = queryMatch[1];
        } else {
          itemId = decoded.trim();
        }
      }

      if (itemId) {
        if (/^not_med\d+$/i.test(itemId)) {
          itemId = 'Not_Med' + itemId.substring(7);
        }
        pararScanner();
        window.location.href = `/emprestimo/movimentar.html?id=${itemId}`;
      } else {
        alert('QR Code inválido: ' + decoded);
      }
    }
  ).catch(() => alert('Permita o acesso à câmera para escanear.'));
};

window.fecharScanner = function() { pararScanner(); };

function pararScanner() {
  if (scannerInstance) {
    scannerInstance.stop().finally(() => {
      document.getElementById('scanner-modal').classList.remove('active');
      scannerInstance = null;
    });
  } else {
    document.getElementById('scanner-modal').classList.remove('active');
  }
}

window.fecharModalESair = function() {
  document.getElementById('success-modal').classList.remove('active');
  window.location.href = './';
};

window.fecharQR = function() {
  document.getElementById('qr-modal').classList.remove('active');
};

