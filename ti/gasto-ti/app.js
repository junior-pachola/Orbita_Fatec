import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { firebaseConfig } from "../../core/firebase-config.js";
import { setupLayout, getCachedAuth, setCachedAuth, clearCachedAuth } from '../../core/layout.js';

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);

const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.'))
  ? `http://${window.location.hostname}:3000/api`
  : '/api';

let currentUser = null;
let currentRole = null;
let userLevel = 1;
let appInitialized = false;
let initializedRole = null;

let gastos = [];

async function apiFetch(endpoint, options = {}) {
  const token = await currentUser.getIdToken();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erro na API: ${res.status}`);
  }
  return res.json();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoeda = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// Data local (não UTC) — evita errar o dia perto da meia-noite (Brasil é UTC-3).
const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtData = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '';

const TIPO_LABEL = { mensal: 'Mensal', unico: 'Único', outros: 'Outros' };

// ==========================================
// AUTH GUARD E INICIALIZAÇÃO
// ==========================================
const cached = getCachedAuth();
if (cached && (cached.role === 'adm_l1' || cached.role === 'adm_l2' || cached.role === 'ti')) {
  currentUser = cached.user;
  currentRole = cached.role;
  initApp(cached.user, cached.role);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clearCachedAuth();
    window.location.href = '../../auth/login.html';
    return;
  }

  currentUser = user;
  try {
    const token = await user.getIdToken();
    let role = 'visitante';
    try {
      const userData = await apiFetch('/usuarios/me');
      role = userData.role || 'visitante';
    } catch (err) {
      role = cached ? cached.role : 'visitante';
    }

    setCachedAuth(user, role, token);

    let level = 1;
    if (role === 'adm_l1') {
      level = 3;
    } else {
      try {
        const perms = await apiFetch('/usuarios/config/permissions');
        const rolePerms = perms[role] || {};
        const rawPerm = rolePerms['gasto-ti'];
        level = (rawPerm !== undefined && typeof rawPerm === 'object')
          ? (rawPerm.execute ? 3 : (rawPerm.view ? 2 : 1))
          : (parseInt(rawPerm) || 1);
      } catch (e) {
        // sem fallback especial: gasto-ti é restrito por padrão
      }
    }
    userLevel = level;

    if (level < 2) {
      window.location.href = '../../meu-espaco/index.html';
      return;
    }

    document.body.classList.toggle('hide-execute', level < 3);

    if (!appInitialized || initializedRole !== role || (cached && (cached.user.displayName !== user.displayName || cached.user.email !== user.email))) {
      currentRole = role;
      initApp(user, role);
    }
  } catch (err) {
    console.error("Erro na revalidação de auth:", err);
  }
});

async function initApp(user, role) {
  if (appInitialized && initializedRole === role) return;
  appInitialized = true;
  initializedRole = role;

  setupLayout(user, role, 'gasto-ti', async () => {
    clearCachedAuth();
    await signOut(auth);
    window.location.href = '../../auth/login.html';
  });

  document.getElementById('app').classList.remove('hidden');

  setupFiltros();
  setupModalGasto();
  setupModalLancamento();
  setupModalHistorico();
  await loadGastos();
}

// ==========================================
// LISTAGEM / FILTROS / KPIS
// ==========================================

async function loadGastos() {
  const lista = document.getElementById('gastos-list');
  try {
    lista.innerHTML = '<div class="empty-state"><p>Carregando gastos...</p></div>';
    gastos = await apiFetch('/gasto-ti/itens');
    atualizarKpis();
    aplicarFiltros();
  } catch (err) {
    lista.innerHTML = `<div class="empty-state"><p>Erro ao carregar: ${esc(err.message)}</p></div>`;
  }
}

function atualizarKpis() {
  const total = gastos.reduce((soma, g) => soma + (g.valorTotal || 0), 0);
  const vencidos = gastos.filter(gastoEstaVencido).length;
  document.getElementById('kpi-total').textContent = fmtMoeda(total);
  document.getElementById('kpi-qtd').textContent = gastos.length;
  document.getElementById('kpi-vencidos').textContent = vencidos;
}

// Mensal de valor fixo nunca fica "vencido" (é lançado sozinho quando o dia
// chega). Mensal variável: passou do dia e ainda não tem lançamento este
// mês. Único/outros: passou da data de vencimento.
function gastoEstaVencido(g) {
  if (g.tipo === 'mensal') {
    if (g.valorFixo) return false;
    if (!g.diaVencimento || g.pagoEsteMes) return false;
    return new Date().getDate() >= g.diaVencimento;
  }
  return !!(g.vencimento && g.vencimento <= hojeISO());
}

function setupFiltros() {
  document.getElementById('search-gastos')?.addEventListener('input', aplicarFiltros);
  document.getElementById('filtro-tipo')?.addEventListener('change', aplicarFiltros);
}

function aplicarFiltros() {
  const query = (document.getElementById('search-gastos')?.value || '').toLowerCase();
  const tipo = document.getElementById('filtro-tipo')?.value;

  const filtrados = gastos.filter(g => {
    const matchQuery = !query ||
      g.nome.toLowerCase().includes(query) ||
      (g.descricao || '').toLowerCase().includes(query);
    const matchTipo = !tipo || g.tipo === tipo;
    return matchQuery && matchTipo;
  });
  renderGastos(filtrados);
}

// Retorna { status: 'pago'|'vencido'|'vencendo'|'ok', texto }
function statusEBadgeVencimento(g) {
  if (g.tipo === 'mensal') {
    if (!g.diaVencimento) return null;
    const dia = g.diaVencimento;

    if (g.valorFixo) {
      return g.pagoEsteMes
        ? { status: 'pago', texto: `✅ Lançado automaticamente — vence todo dia ${dia}` }
        : { status: 'ok', texto: `Vence todo dia ${dia} (lançamento automático)` };
    }

    if (g.pagoEsteMes) return { status: 'pago', texto: `✅ Lançado este mês — vence todo dia ${dia}` };
    const diaHoje = new Date().getDate();
    if (diaHoje >= dia) return { status: 'vencido', texto: `⏰ Venceu dia ${dia} — falta lançar o valor deste mês` };
    if (dia - diaHoje <= 5) return { status: 'vencendo', texto: `⏳ Vence dia ${dia} deste mês` };
    return { status: 'ok', texto: `Vence todo dia ${dia}` };
  }

  if (!g.vencimento) return null;
  const hoje = hojeISO();
  if (g.vencimento <= hoje) return { status: 'vencido', texto: `⏰ Vencido em ${fmtData(g.vencimento)}` };
  const limite = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const limiteIso = `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, '0')}-${String(limite.getDate()).padStart(2, '0')}`;
  if (g.vencimento <= limiteIso) return { status: 'vencendo', texto: `⏳ Vence em ${fmtData(g.vencimento)}` };
  return { status: 'ok', texto: `Vence em ${fmtData(g.vencimento)}` };
}

function renderGastos(lista) {
  const container = document.getElementById('gastos-list');
  container.innerHTML = '';

  if (!lista.length) {
    container.innerHTML = `<div class="empty-state"><p>${gastos.length ? 'Nenhum gasto corresponde ao filtro.' : 'Nenhum gasto cadastrado ainda.'}</p></div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'gti-grid';
  lista.forEach(g => {
    const venc = statusEBadgeVencimento(g);
    const ehMensalFixo = g.tipo === 'mensal' && g.valorFixo === true;
    const tipoTexto = g.tipo === 'mensal'
      ? `${TIPO_LABEL.mensal} · ${g.valorFixo ? 'Fixo' : 'Variável'}`
      : (TIPO_LABEL[g.tipo] || g.tipo);
    const card = document.createElement('div');
    card.className = 'gti-card';
    card.innerHTML = `
      <div class="gti-card-topo">
        <div class="gti-card-nome">${esc(g.nome)}</div>
        <span class="gti-card-tipo">${esc(tipoTexto)}</span>
      </div>
      ${g.descricao ? `<div class="gti-card-desc">${esc(g.descricao)}</div>` : ''}
      <div class="gti-card-valores">
        <div><span>Referência</span><b>${fmtMoeda(g.valor)}</b></div>
        <div><span>Acumulado</span><b>${fmtMoeda(g.valorTotal)}</b></div>
      </div>
      ${venc ? `<div class="gti-card-venc">
          <span class="badge-venc badge-venc-${venc.status}">${venc.texto}</span>
        </div>` : ''}
      <div class="gti-card-actions action-execute">
        ${ehMensalFixo ? '' : '<button class="btn-lancar" data-acao="lancar">💰 Lançar novo valor</button>'}
        <button data-acao="historico">Histórico</button>
        <button data-acao="editar">Editar</button>
        <button class="btn-excluir" data-acao="excluir">Excluir</button>
      </div>
    `;
    if (!ehMensalFixo) card.querySelector('[data-acao="lancar"]').addEventListener('click', () => abrirModalLancamento(g));
    card.querySelector('[data-acao="historico"]').addEventListener('click', () => abrirHistorico(g));
    card.querySelector('[data-acao="editar"]').addEventListener('click', () => abrirModalGasto(g));
    card.querySelector('[data-acao="excluir"]').addEventListener('click', () => excluirGasto(g));
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

// ==========================================
// MODAL: NOVO / EDITAR GASTO
// ==========================================

function setupModalGasto() {
  const modal = document.getElementById('modal-gasto');
  document.getElementById('btn-novo-gasto')?.addEventListener('click', () => abrirModalGasto(null));
  document.getElementById('btn-cancelar-gasto')?.addEventListener('click', () => modal.classList.add('hidden'));
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  document.getElementById('form-gasto')?.addEventListener('submit', salvarGasto);
  document.getElementById('gti-tipo')?.addEventListener('change', alternarCamposVencimento);
  document.querySelectorAll('#gti-valor-fixo-toggle .gti-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => selecionarValorFixo(btn.dataset.valor === 'true'));
  });
}

function selecionarValorFixo(fixo) {
  document.getElementById('gti-valor-fixo').value = fixo ? 'true' : 'false';
  document.querySelectorAll('#gti-valor-fixo-toggle .gti-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.valor === 'true') === fixo);
  });
  document.getElementById('gti-valor-fixo-hint').textContent = fixo
    ? 'Fixo (ex: VPS): assim que vencer, lança sozinho repetindo o valor de referência. Ninguém precisa clicar em nada.'
    : 'Variável (ex: Firebase): quando o dia vencer, fica em branco aguardando você lançar o valor real do mês.';
}

function alternarCamposVencimento() {
  const mensal = document.getElementById('gti-tipo').value === 'mensal';
  document.getElementById('grupo-dia-vencimento').classList.toggle('hidden', !mensal);
  document.getElementById('grupo-valor-fixo').classList.toggle('hidden', !mensal);
  document.getElementById('grupo-data-vencimento').classList.toggle('hidden', mensal);
  document.getElementById('gti-dia-vencimento').required = mensal;
}

function abrirModalGasto(gasto) {
  document.getElementById('form-gasto').reset();
  const editando = !!gasto;
  document.getElementById('gti-id').value = editando ? gasto.id : '';
  document.getElementById('gti-nome').value = editando ? gasto.nome : '';
  document.getElementById('gti-descricao').value = editando ? (gasto.descricao || '') : '';
  document.getElementById('gti-tipo').value = editando ? gasto.tipo : 'mensal';
  document.getElementById('gti-valor').value = editando ? gasto.valor : '';
  document.getElementById('gti-dia-vencimento').value = editando ? (gasto.diaVencimento || '') : '';
  document.getElementById('gti-vencimento').value = editando ? (gasto.vencimento || '') : '';
  selecionarValorFixo(editando ? gasto.valorFixo !== false : true);
  alternarCamposVencimento();
  document.getElementById('modal-gasto-title').textContent = editando ? 'Editar Gasto' : 'Novo Gasto';
  document.getElementById('btn-salvar-gasto').textContent = editando ? 'Salvar alterações' : 'Cadastrar';
  document.getElementById('modal-gasto').classList.remove('hidden');
  document.getElementById('gti-nome').focus();
}

async function salvarGasto(e) {
  e.preventDefault();
  const id = document.getElementById('gti-id').value;
  const btn = document.getElementById('btn-salvar-gasto');
  const tipo = document.getElementById('gti-tipo').value;
  const dados = {
    nome: document.getElementById('gti-nome').value.trim(),
    descricao: document.getElementById('gti-descricao').value.trim(),
    tipo,
    valor: document.getElementById('gti-valor').value,
    diaVencimento: tipo === 'mensal' ? document.getElementById('gti-dia-vencimento').value : null,
    valorFixo: tipo === 'mensal' ? (document.getElementById('gti-valor-fixo').value === 'true') : null,
    vencimento: tipo !== 'mensal' ? document.getElementById('gti-vencimento').value : null
  };

  btn.disabled = true;
  btn.textContent = id ? 'Salvando...' : 'Cadastrando...';
  try {
    if (id) {
      await apiFetch(`/gasto-ti/itens/${id}`, { method: 'PUT', body: JSON.stringify(dados) });
      showToast('Gasto atualizado');
    } else {
      await apiFetch('/gasto-ti/itens', { method: 'POST', body: JSON.stringify(dados) });
      showToast('Gasto cadastrado');
    }
    document.getElementById('modal-gasto').classList.add('hidden');
    await loadGastos();
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = id ? 'Salvar alterações' : 'Cadastrar';
  }
}

async function excluirGasto(gasto) {
  if (!confirm(`Excluir o gasto "${gasto.nome}"? O histórico de lançamentos também será apagado.`)) return;
  try {
    await apiFetch(`/gasto-ti/itens/${gasto.id}`, { method: 'DELETE' });
    showToast('Gasto excluído');
    await loadGastos();
  } catch (err) {
    showToast('Erro ao excluir: ' + err.message, 'error');
  }
}

// ==========================================
// MODAL: LANÇAR VALOR MENSAL
// ==========================================

function setupModalLancamento() {
  const modal = document.getElementById('modal-lancamento');
  document.getElementById('btn-cancelar-lancamento')?.addEventListener('click', () => modal.classList.add('hidden'));
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  document.getElementById('form-lancamento')?.addEventListener('submit', salvarLancamento);
}

function abrirModalLancamento(gasto) {
  document.getElementById('form-lancamento').reset();
  document.getElementById('lanc-gasto-id').value = gasto.id;
  document.getElementById('lanc-gasto-nome').textContent = gasto.nome;
  document.getElementById('lanc-valor').value = gasto.valor || '';
  document.getElementById('modal-lancamento').classList.remove('hidden');
  document.getElementById('lanc-valor').focus();
}

async function salvarLancamento(e) {
  e.preventDefault();
  const gastoId = document.getElementById('lanc-gasto-id').value;
  const btn = document.getElementById('btn-salvar-lancamento');
  const dados = {
    valor: document.getElementById('lanc-valor').value,
    observacoes: document.getElementById('lanc-observacoes').value.trim()
  };

  btn.disabled = true;
  btn.textContent = 'Lançando...';
  try {
    await apiFetch(`/gasto-ti/itens/${gastoId}/lancamentos`, { method: 'POST', body: JSON.stringify(dados) });
    showToast('Valor lançado');
    document.getElementById('modal-lancamento').classList.add('hidden');
    await loadGastos();
  } catch (err) {
    showToast('Erro ao lançar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lançar';
  }
}

// ==========================================
// HISTÓRICO DE LANÇAMENTOS
// ==========================================

function setupModalHistorico() {
  const modal = document.getElementById('modal-historico');
  document.getElementById('btn-fechar-historico')?.addEventListener('click', () => modal.classList.add('hidden'));
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
}

async function abrirHistorico(gasto) {
  const modal = document.getElementById('modal-historico');
  const lista = document.getElementById('historico-lista');
  lista.innerHTML = '<p class="hist-vazio">Carregando...</p>';
  modal.classList.remove('hidden');
  try {
    const lancamentos = await apiFetch(`/gasto-ti/itens/${gasto.id}/lancamentos`);
    if (!lancamentos.length) {
      lista.innerHTML = '<p class="hist-vazio">Nenhum valor lançado ainda.</p>';
      return;
    }
    lista.innerHTML = lancamentos.map(l => `
      <div class="hist-row">
        <div><b>${fmtMoeda(l.valor)}</b> — ${fmtData(l.data)}</div>
        ${l.observacoes ? `<div class="hist-obs">${esc(l.observacoes)}</div>` : ''}
      </div>
    `).join('');
  } catch (err) {
    lista.innerHTML = `<p class="hist-vazio">Erro: ${esc(err.message)}</p>`;
  }
}

// ==========================================
// TOAST
// ==========================================

let toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}
