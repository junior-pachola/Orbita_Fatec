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

async function apiFetch(endpoint, options = {}) {
  let token = '';
  if (currentUser && typeof currentUser.getIdToken === 'function') {
    token = await currentUser.getIdToken();
  } else if (auth.currentUser) {
    token = await auth.currentUser.getIdToken();
  }
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
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
  
  // Garante que "Notebook" seja a primeira categoria, e remove qualquer residual de "Outros"
  categorias = merged.filter(c => c.toLowerCase() !== 'outros' && c.toLowerCase() !== 'outro');
  // Se por algum motivo 'Notebook' não estiver na lista, adiciona no início
  if (!categorias.some(c => c.toLowerCase() === 'notebook')) {
    categorias.unshift('Notebook');
  }
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
    tab.textContent = `${cat} (${count})`;
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
  let role = 'visitante';
  let meuOverrides = null;
  try {
    const userData = await apiFetch('/usuarios/me');
    role = userData.role || 'visitante';
    meuOverrides = userData.permissoes || null;
  } catch (err) {
    role = cached ? cached.role : 'visitante';
  }

  // Nível EFETIVO: override individual do usuário vence o do cargo
  let userLevel = 1;
  try {
    const allPerms = await apiFetch('/usuarios/config/permissions');
    userLevel = getEffectiveLevel(allPerms[role] || {}, meuOverrides, 'emprestimo');
  } catch (err) {
    // Falha silenciosa para segurança
  }

  const token = await user.getIdToken();
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
async function loadNotebooks() {
  try {
    notebooksDB = await apiFetch('/emprestimos');
    // Normaliza itens legados (sem tipo, 'Outros', 'outro', 'notbooks', etc.) para 'Notebook'
    notebooksDB.forEach(n => {
      if (!n.tipo || n.tipo.trim() === '' || n.tipo.toLowerCase() === 'outros' || n.tipo.toLowerCase() === 'outro' || n.tipo.toLowerCase() === 'notbooks' || n.tipo.toLowerCase() === 'notbook') {
        n.tipo = 'Notebook';
      }
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
      
      // Recarregar itens e atualizar grid
      await loadNotebooks();
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

    // Devolver button
    const devolverBtn = e.target.closest('.btn-devolver');
    if (devolverBtn) {
      const id = devolverBtn.dataset.id;
      const note = notebooksDB.find(n => n.id === id);
      if (!note) return;
      
      if (note.temporario) {
        const originalText = devolverBtn.textContent;
        devolverBtn.textContent = 'Removendo...';
        devolverBtn.disabled = true;

        try {
          await apiFetch(`/emprestimos/${id}`, { method: 'DELETE' });
          await loadNotebooks();
          applyFilters();
        } catch (err) {
          console.error(err);
          alert('Erro ao excluir item temporário: ' + err.message);
          devolverBtn.textContent = originalText;
          devolverBtn.disabled = false;
        }
      } else {
        if (confirm(`Confirmar devolução do item "${id}"?\nEle será marcado como Guardado (Disponível).`)) {
          const originalText = devolverBtn.textContent;
          devolverBtn.textContent = 'Processando...';
          devolverBtn.disabled = true;
          
          const userName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Desconhecido';
          
          const updatedItem = {
            ...note,
            status: 'guardado',
            local: 'T.I.',
            sala: '',
            funcionario: '',
            setor: '',
            requerente: '',
            observacao: '',
            responsavel: userName,
            updatedAt: new Date().toISOString()
          };

          try {
            await apiFetch(`/emprestimos/${id}`, {
              method: 'PUT',
              body: JSON.stringify(updatedItem)
            });
            await loadNotebooks();
            applyFilters();
          } catch (err) {
            console.error(err);
            alert('Erro ao devolver item: ' + err.message);
            devolverBtn.textContent = originalText;
            devolverBtn.disabled = false;
          }
        }
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
    const tipo = 'Notebook'; // Default to Notebook to avoid issues, or 'Outros'
    const requerente = document.getElementById('er-requerente').value.trim();
    const observacao = document.getElementById('er-observacao').value.trim();
    const destinoRadio = document.querySelector('input[name="er-destino"]:checked');

    // Validações
    if (!id || !requerente || !destinoRadio) {
      alert('Preencha todos os campos obrigatórios.');
      return;
    }

    const existing = notebooksDB.find(n => n.id.toLowerCase() === id.toLowerCase());
    if (existing) {
      alert(`Já existe um item com o ID "${id}". Por favor, escolha outro identificador.`);
      return;
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

    const newItem = {
      id,
      tipo,
      temQrCode: false,
      temporario: true, // Flag as temporary item
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
    };

    try {
      await apiFetch(`/emprestimos/${id}`, {
        method: 'PUT',
        body: JSON.stringify(newItem)
      });

      window.fecharEmprestimoRapido();
      await loadNotebooks();
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
      successMsg.innerHTML = `<span>✅</span><span>Empréstimo temporário de <strong>${id}</strong> realizado com sucesso!</span>`;
      document.body.appendChild(successMsg);
      setTimeout(() => successMsg.remove(), 4000);

    } catch (err) {
      console.error(err);
      alert('Erro ao processar Empréstimo Rápido: ' + err.message);
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

  list.forEach(n => {
    const card = document.createElement('div');
    card.className = 'notebook-card';
    card.dataset.id = n.id;
    card.style.borderTop = `4px solid var(--c-${n.temporario ? 'temporario' : n.status})`;
    card.style.cursor = 'pointer';

    const updateStr = n.updatedAt ? new Date(n.updatedAt).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'}) + ', ' + new Date(n.updatedAt).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : '---';

    const qrBtnHtml = n.temQrCode !== false 
      ? `<button class="btn btn-secondary btn-qr action-execute" data-id="${n.id}" style="opacity:0.4; font-size:0.75rem">GERAR QR</button>` 
      : `<button class="btn btn-secondary action-execute" disabled style="opacity:0.2; font-size:0.75rem; cursor:not-allowed" title="Item configurado sem QR Code">SEM QR</button>`;

    card.innerHTML = `
      <div class="card-header">
        <div style="display:flex; align-items:center; gap:0.5rem">
          <span class="card-id" title="${esc(n.tipo || 'Notebook')}">${esc(n.id)} ${n.tipo && !n.temporario ? `<span style="font-size:0.75rem; color:var(--text-secondary); font-weight:normal;">(${esc(n.tipo)})</span>` : ''}</span>
          <span class="badge badge-${n.temporario ? 'temporario' : n.status}">${n.temporario ? 'TEMPORÁRIO' : esc(n.status.toUpperCase())}</span>
        </div>
        <div style="display:flex; align-items:center; gap:0.25rem">
          ${!n.temporario ? `
            <button class="btn-pin action-execute" data-id="${n.id}" title="${n.comentarioFixado?'Editar/Remover Comentário':'Fixar Comentário'}" style="background:none; border:none; color:${n.comentarioFixado?'var(--accent-orange)':'var(--text-muted)'}; cursor:pointer; padding:5px; display:flex; align-items:center; transition:0.2s">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.89A.5.5 0 0 0 6.36 14h11.28a.5.5 0 0 0 .25-.56l-1.78-.89a2 2 0 0 1-1.11-1.79V4h-6v6.76zM6 4h12"/></svg>
            </button>
            <button class="btn-lock action-execute ${n.status==='reservado'?'active':''}" data-id="${n.id}" title="${n.status==='reservado'?'Liberar':'Reservar'}" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:5px; display:flex; align-items:center; transition:0.2s">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
      
      <div class="card-detail">
        <span>${
          n.status === 'emprestado' ? `🏫 Sala ${esc(n.sala)}` :
          n.status === 'cedido'     ? `👤 ${esc(n.funcionario)} — ${esc(n.setor)}` :
          n.status === 'reservado'  ? `🔒 ${n.requerente ? `Para: ${esc(n.requerente)} ` : 'Reservado'}${n.dataDevolucao ? `(Até ${n.dataDevolucao.split('-').reverse().join('/')})` : ''}` :
          `📦 ${esc(n.local || 'T.I.')}`
        }</span>
        ${n.observacao ? `<div style="margin-top: 5px; font-size: 0.8rem; color: var(--text-muted); font-style: italic;">💬 ${esc(n.observacao)}</div>` : ''}
      </div>

      ${n.comentarioFixado ? `
      <div class="card-pinned-comment" data-id="${n.id}" style="margin-bottom: 1.25rem; padding: 0.5rem 0.75rem; background: rgba(235, 112, 37, 0.05); border-left: 3px solid var(--accent-orange); border-radius: 6px; font-size: 0.85rem; color: var(--text-main); display: flex; align-items: flex-start; gap: 0.4rem; cursor: pointer;" title="Editar comentário fixado">
        <span style="font-size: 0.9rem; line-height: 1;">📌</span>
        <span style="word-break: break-word; font-weight: 500;">${esc(n.comentarioFixado)}</span>
      </div>` : ''}

      <div class="card-footer">
        <span>🕒 ${updateStr}</span>
        <span style="font-weight:700; color:var(--purple-bright)">👤 ${esc(n.responsavel || '---')}</span>
      </div>

      <div class="card-actions">
        ${n.temporario ? `
          <button class="btn btn-devolver action-execute" data-id="${n.id}" style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; font-weight: 700; border-radius: 8px; flex: 1; width: 100%;">Devolvido</button>
        ` : `
          <a href="movimentar.html?id=${n.id}" class="btn btn-secondary action-execute">Movimentar</a>
          ${qrBtnHtml}
        `}
      </div>
    `;
    grid.appendChild(card);
  });
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

    if (nameEl) nameEl.textContent = n.id;
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

  radios.forEach(r => r.addEventListener('change', e => renderFields(e.target.value)));

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

    await apiFetch(`/emprestimos/${noteObj.id}`, { method: 'PUT', body: JSON.stringify(noteObj) });

    btn.textContent='Confirmar Mudança'; btn.disabled=false;
    
    const mTitle = document.getElementById('modal-title');
    const mDesc  = document.getElementById('modal-desc');
    const mSum   = document.getElementById('modal-summary');
    
    if (mTitle) mTitle.textContent = 'Atualizado!';
    if (mDesc)  mDesc.textContent  = `${noteObj.id} registrado com sucesso.`;
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

