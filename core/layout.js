import { MODULES, CATEGORIES, getRoleConfig, hasPermission, getAccessLevel } from './permissions.js';

export function setupLayout(user, role, activeModuleId, onLogout) {
  // Carregar permissões EFETIVAS (cargo + overrides do usuário) do cache local
  const cachedPermsRaw = localStorage.getItem('orbita_permissions');
  let cachedPerms = null;
  if (cachedPermsRaw) {
    try {
      cachedPerms = JSON.parse(cachedPermsRaw);
    } catch (e) {}
  }

  // Guard de acesso à página: com cache, decide pelo nível efetivo;
  // sem cache, cai na lista estática do cargo (primeiro load)
  if (role !== 'adm_l1' && activeModuleId !== 'dashboard' && activeModuleId !== 'fidelidade') {
    if (cachedPerms) {
      if (getAccessLevel(cachedPerms[activeModuleId]) < 2) {
        window.location.href = '/meu-espaco/index.html';
        return;
      }
    } else if (!hasPermission(role, activeModuleId)) {
      window.location.href = '/index.html';
      return;
    }
  }

  const roleConfig = getRoleConfig(role);

  // Visibilidade de módulo no menu: nível efetivo >= 2 quando há cache;
  // sem cache, fallback para a lista estática do cargo
  const podeVerModulo = (modId) => {
    if (role === 'adm_l1') return true;
    if (modId === 'dashboard' || modId === 'fidelidade') return true;
    if (cachedPerms) return getAccessLevel(cachedPerms[modId]) >= 2;
    return roleConfig.modules.includes(modId);
  };
  const name = user.displayName || user.email.split('@')[0];
  const initial = name.charAt(0).toUpperCase();

  // Criar Sidebar
  const sidebar = document.createElement('aside');
  sidebar.className = 'layout-sidebar';
  
  const sidebarHeader = document.createElement('div');
  sidebarHeader.className = 'layout-sidebar-header';
  sidebarHeader.innerHTML = `
    <a href="/index.html" class="layout-brand">
      <div class="orbit-container">
        <div class="orbit-center">F</div>
        <div class="orbit-planet"></div>
      </div>
      <span class="logo-orbita">ÓRBITA</span><span class="logo-fatec">FATEC</span>
    </a>
  `;
  sidebar.appendChild(sidebarHeader);

  // Perfil de Usuário para Mobile na Sidebar (oculto no desktop)
  const sidebarUser = document.createElement('div');
  sidebarUser.className = 'layout-sidebar-user-mobile';
  sidebarUser.innerHTML = `
    <div class="layout-user-avatar">${initial}</div>
    <div class="layout-user-details-mobile">
      <span class="layout-user-name">${name}</span>
      <span class="layout-user-role">${roleConfig.label}</span>
    </div>
  `;
  sidebar.appendChild(sidebarUser);

  const nav = document.createElement('nav');
  nav.className = 'layout-nav';
  
  // 1. Renderizar Módulos sem Categoria (Top-level)
  // "fidelidade" (Cartão FATEC) fica fora do menu por hora — não está em uso
  // no momento. O módulo/rota continuam existindo, só não aparece no menu.
  const topLevelModules = Object.values(MODULES).filter(mod =>
    !mod.category && mod.id !== 'fidelidade' && podeVerModulo(mod.id));

  topLevelModules.forEach(mod => {
    const link = document.createElement('a');
    link.href = mod.url;
    link.className = `layout-nav-item ${mod.id === activeModuleId ? 'active' : ''}`;
    link.dataset.modId = mod.id;
    link.innerHTML = `${mod.icon} <span>${mod.title}</span>`;
    nav.appendChild(link);
  });

  // 2. Renderizar por Categorias
  Object.entries(CATEGORIES).forEach(([catKey, catLabel]) => {
    // Filtrar módulos desta categoria que o usuário tem permissão
    const permittedInCat = Object.values(MODULES).filter(mod =>
      mod.category === catKey && podeVerModulo(mod.id));

    if (permittedInCat.length > 0) {
      const catWrapper = document.createElement('div');
      catWrapper.className = 'layout-nav-section';

      // Verificar se o módulo ativo está nesta categoria para deixá-la aberta
      const hasActiveMod = permittedInCat.some(m => m.id === activeModuleId);
      const isCollapsed = !hasActiveMod;

      // Adicionar Label da Categoria (com ícone de toggle)
      const label = document.createElement('div');
      label.className = `layout-nav-category ${isCollapsed ? 'collapsed' : ''}`;
      label.innerHTML = `
        <span>${catLabel}</span>
        <svg class="category-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
      `;
      
      const group = document.createElement('div');
      group.className = `layout-nav-group ${isCollapsed ? 'collapsed' : ''}`;

      // Toggle Logic
      label.addEventListener('click', () => {
        label.classList.toggle('collapsed');
        group.classList.toggle('collapsed');
      });

      // Adicionar Módulos
      permittedInCat.forEach(mod => {
        const link = document.createElement('a');
        link.href = mod.url;
        link.className = `layout-nav-item ${mod.id === activeModuleId ? 'active' : ''}`;
        link.dataset.modId = mod.id;
        link.innerHTML = `${mod.icon} <span>${mod.title}</span>`;
        group.appendChild(link);
      });

      catWrapper.appendChild(label);
      catWrapper.appendChild(group);
      nav.appendChild(catWrapper);
    }
  });
  
  sidebar.appendChild(nav);

  // Criar Footer com botão de logout na Sidebar para Mobile (oculto no desktop)
  const sidebarFooter = document.createElement('div');
  sidebarFooter.className = 'layout-sidebar-footer-mobile';
  sidebarFooter.innerHTML = `
    <button class="layout-sidebar-logout-btn-mobile" id="layout-sidebar-logout-btn-mobile">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
      <span>Sair do Órbita</span>
    </button>
  `;
  sidebar.appendChild(sidebarFooter);

  // Criar Header
  const header = document.createElement('header');
  header.className = 'layout-header';
  const activeMod = MODULES[activeModuleId];
  header.innerHTML = `
    <div class="layout-header-left">
      <button class="layout-sidebar-toggle" id="layout-sidebar-toggle" aria-label="Abrir menu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
      <div class="layout-header-title">
        ${activeMod ? activeMod.title : 'Dashboard'}
      </div>
    </div>
    <div class="layout-header-actions">
      <span class="layout-user-role">${roleConfig.label}</span>
      <div class="layout-user-info">
        <div class="layout-user-avatar">${initial}</div>
        <span class="layout-user-name">${name}</span>
      </div>
      <button class="layout-logout-btn" id="layout-logout-btn" title="Sair">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>
  `;

  // Criar Overlay para mobile
  const overlay = document.createElement('div');
  overlay.className = 'layout-sidebar-overlay';

  // Injetar no DOM
  const wrapper = document.querySelector('.layout-wrapper');
  if (wrapper) {
    const existingSidebar = wrapper.querySelector('.layout-sidebar');
    if (existingSidebar) existingSidebar.remove();

    const existingHeader = wrapper.querySelector('.layout-header');
    if (existingHeader) existingHeader.remove();

    const existingOverlay = wrapper.querySelector('.layout-sidebar-overlay');
    if (existingOverlay) existingOverlay.remove();

    wrapper.insertBefore(sidebar, wrapper.firstChild);
    wrapper.appendChild(overlay);
    const main = wrapper.querySelector('.layout-main');
    if (main) {
      main.insertBefore(header, main.firstChild);
    }
  }

  // Toggle Sidebar Mobile
  const toggleBtn = document.getElementById('layout-sidebar-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('active');
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }

  // Fechar sidebar ao clicar em um link do menu no mobile
  const navItems = sidebar.querySelectorAll('.layout-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  });

  // Evento de Logout
  const logoutBtn = document.getElementById('layout-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearCachedAuth();
      if (onLogout) onLogout();
    });
  }

  // Evento de Logout Mobile
  const logoutBtnMobile = document.getElementById('layout-sidebar-logout-btn-mobile');
  if (logoutBtnMobile) {
    logoutBtnMobile.addEventListener('click', () => {
      clearCachedAuth();
      if (onLogout) onLogout();
    });
  }

  // Atualizar permissões EFETIVAS em segundo plano e cachear:
  // nível do cargo (config/permissions) mesclado com os overrides
  // individuais do usuário (users/{uid}.permissoes) — override vence.
  const token = localStorage.getItem('orbita_token');
  const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.'))
    ? `http://${window.location.hostname}:3000/api`
    : '/api';

  // Indicador de notificação (círculo vermelho) no menu: hoje só o módulo
  // Gasto T.I. usa isso, pra sinalizar gasto(s) com vencimento já passado.
  // Fica num mapa pra ficar fácil plugar outros módulos no futuro.
  const NOTIFICATION_ENDPOINTS = {
    'gasto-ti': '/gasto-ti/itens/alertas'
  };

  if (token) {
    const authHeaders = { 'Authorization': `Bearer ${token}` };
    const fetchJson = (url) => fetch(url, { headers: authHeaders })
      .then(res => { if (res.ok) return res.json(); throw new Error(); });

    Object.entries(NOTIFICATION_ENDPOINTS).forEach(([modId, endpoint]) => {
      if (!podeVerModulo(modId)) return;
      fetchJson(`${API_BASE}${endpoint}`)
        .then(data => {
          if (!data || !data.total) return;
          const link = sidebar.querySelector(`.layout-nav-item[data-mod-id="${modId}"]`);
          if (link && !link.querySelector('.layout-nav-badge')) {
            const dot = document.createElement('span');
            dot.className = 'layout-nav-badge';
            dot.title = 'Há pendências neste módulo';
            link.appendChild(dot);
          }
        })
        .catch(() => {});
    });

    const promMe = fetchJson(`${API_BASE}/usuarios/me`);
    const promPerms = role !== 'adm_l1'
      ? fetchJson(`${API_BASE}/usuarios/config/permissions`)
      : Promise.resolve(null);

    Promise.all([promMe, promPerms])
      .then(([userData, allPerms]) => {
        if (userData && userData.primeiroAcesso === true) {
          showFirstAccessModal(token, API_BASE);
        }

        if (role !== 'adm_l1' && allPerms) {
          const rolePerms = allPerms[role] || {};
          const efetivas = { ...rolePerms, ...(userData?.permissoes || {}) };
          const novasJson = JSON.stringify(efetivas);
          localStorage.setItem('orbita_permissions', novasJson);

          // Se a visualização do módulo ativo foi desativada, redireciona
          if (activeModuleId !== 'dashboard' && activeModuleId !== 'fidelidade') {
            if (getAccessLevel(efetivas[activeModuleId]) < 2) {
              window.location.href = '/meu-espaco/index.html';
              return;
            }
          }

          // O menu foi montado com o cache antigo (ou sem cache). Se as
          // permissões reais divergem, recarrega UMA vez para re-renderizar
          // (flag de sessão evita loop de reloads).
          if (novasJson !== (cachedPermsRaw || '')) {
            if (!sessionStorage.getItem('orbita_perms_refresh')) {
              sessionStorage.setItem('orbita_perms_refresh', '1');
              window.location.reload();
            }
          } else {
            sessionStorage.removeItem('orbita_perms_refresh');
          }
        }
      })
      .catch(() => {});
  }

  // Remover auth-guard e mostrar app
  const authGuard = document.getElementById('auth-guard');
  if (authGuard) authGuard.style.display = 'none';
  
  const app = document.getElementById('app');
  if (app) app.classList.remove('hidden');
}

// ==========================================
//  AUTH CACHING HELPERS
// ==========================================
export function getCachedAuth() {
  const uid = localStorage.getItem('orbita_uid');
  const email = localStorage.getItem('orbita_email');
  const displayName = localStorage.getItem('orbita_displayName');
  const role = localStorage.getItem('orbita_role');
  const token = localStorage.getItem('orbita_token');

  if (uid && role) {
    return {
      user: {
        uid,
        email,
        displayName,
        getIdToken: async () => localStorage.getItem('orbita_token') || token || ''
      },
      role,
      token
    };
  }
  return null;
}

export function setCachedAuth(user, role, token) {
  if (user) {
    // Usuário diferente do anterior neste navegador: descarta o cache de
    // permissões da conta antiga (evita menu de um usuário vazar para outro)
    const uidAnterior = localStorage.getItem('orbita_uid');
    if (uidAnterior && uidAnterior !== user.uid) {
      localStorage.removeItem('orbita_permissions');
    }
    localStorage.setItem('orbita_uid', user.uid);
    localStorage.setItem('orbita_email', user.email || '');
    localStorage.setItem('orbita_displayName', user.displayName || user.email?.split('@')[0] || '');
  }
  if (role) {
    localStorage.setItem('orbita_role', role);
  }
  if (token) {
    localStorage.setItem('orbita_token', token);
  }
}

export function clearCachedAuth() {
  localStorage.removeItem('orbita_uid');
  localStorage.removeItem('orbita_email');
  localStorage.removeItem('orbita_displayName');
  localStorage.removeItem('orbita_role');
  localStorage.removeItem('orbita_token');
  localStorage.removeItem('orbita_permissions');
}

function showFirstAccessModal(token, apiBase) {
  // Evitar duplicar modal
  if (document.getElementById('first-access-overlay')) return;

  // Injetar estilos CSS
  const style = document.createElement('style');
  style.innerHTML = `
    .first-access-overlay {
      position: fixed;
      inset: 0;
      background: rgba(3, 20, 38, 0.85);
      backdrop-filter: blur(12px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .first-access-card {
      background: #FFFFFF;
      border-radius: 20px;
      width: 100%;
      max-width: 420px;
      padding: 2.5rem 2rem;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(15, 78, 184, 0.1);
      text-align: center;
      animation: firstAccessFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes firstAccessFadeIn {
      from { opacity: 0; transform: translateY(15px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .first-access-icon {
      font-size: 3rem;
      margin-bottom: 1.25rem;
      display: inline-block;
      animation: lockBounce 2s infinite ease-in-out;
    }
    @keyframes lockBounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }
    .first-access-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.5rem;
      font-weight: 800;
      color: #0B1F33;
      margin-bottom: 0.5rem;
    }
    .first-access-desc {
      font-size: 0.9rem;
      color: #64748B;
      line-height: 1.5;
      margin-bottom: 2rem;
    }
    .first-access-form {
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .first-access-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .first-access-label {
      font-size: 0.75rem;
      font-weight: 700;
      color: #0B1F33;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .first-access-input {
      width: 100%;
      height: 46px;
      padding: 0 1rem;
      border: 1.5px solid #E5E7EB;
      border-radius: 10px;
      font-size: 0.95rem;
      color: #0B1F33;
      outline: none;
      transition: all 0.2s;
    }
    .first-access-input:focus {
      border-color: #0F4EB8;
      box-shadow: 0 0 0 3px rgba(15, 78, 184, 0.1);
    }
    .first-access-btn {
      width: 100%;
      height: 48px;
      background: linear-gradient(135deg, #0F4EB8, #1E63D6);
      color: #FFFFFF;
      border: none;
      border-radius: 12px;
      font-family: 'Outfit', sans-serif;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(15, 78, 184, 0.2);
      transition: all 0.25s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .first-access-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(15, 78, 184, 0.3);
    }
    .first-access-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    .first-access-error {
      color: #EF4444;
      font-size: 0.8rem;
      font-weight: 600;
      margin-top: -0.25rem;
      display: none;
    }
  `;
  document.head.appendChild(style);

  // Criar elemento do modal
  const overlay = document.createElement('div');
  overlay.id = 'first-access-overlay';
  overlay.className = 'first-access-overlay';
  overlay.innerHTML = `
    <div class="first-access-card">
      <span class="first-access-icon">🔐</span>
      <h2 class="first-access-title">Primeiro Acesso</h2>
      <p class="first-access-desc">Por motivos de segurança, você deve redefinir sua senha inicial antes de prosseguir para o sistema.</p>
      
      <form class="first-access-form" id="first-access-form">
        <div class="first-access-group">
          <label class="first-access-label">Nova Senha</label>
          <input type="password" id="first-access-pwd" class="first-access-input" placeholder="Mínimo 6 caracteres" required minlength="6">
        </div>
        <div class="first-access-group">
          <label class="first-access-label">Confirmar Nova Senha</label>
          <input type="password" id="first-access-pwd-conf" class="first-access-input" placeholder="Digite a senha novamente" required minlength="6">
        </div>
        
        <p class="first-access-error" id="first-access-error-msg"></p>
        
        <button type="submit" class="first-access-btn" id="first-access-submit-btn">
          <span>Atualizar Senha</span>
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  // Adicionar lógica de envio
  const form = document.getElementById('first-access-form');
  const pwdInput = document.getElementById('first-access-pwd');
  const confInput = document.getElementById('first-access-pwd-conf');
  const errorMsg = document.getElementById('first-access-error-msg');
  const submitBtn = document.getElementById('first-access-submit-btn');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorMsg.style.display = 'none';

    const pwd = pwdInput.value;
    const conf = confInput.value;

    if (pwd !== conf) {
      errorMsg.textContent = 'As senhas não coincidem.';
      errorMsg.style.display = 'block';
      return;
    }

    if (pwd.length < 6) {
      errorMsg.textContent = 'A senha deve conter pelo menos 6 caracteres.';
      errorMsg.style.display = 'block';
      return;
    }

    // Enviar redefinição
    submitBtn.disabled = true;
    submitBtn.querySelector('span').textContent = 'Processando...';

    fetch(`${apiBase}/usuarios/me/senha`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ senha: pwd })
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(err => { throw new Error(err.error || 'Erro na redefinição'); });
      }
      return res.json();
    })
    .then(() => {
      // Sucesso! Remover modal
      overlay.remove();
      // Mostrar alerta
      alert('Sua senha foi redefinida com sucesso! Bem-vindo ao Órbita.');
    })
    .catch(err => {
      errorMsg.textContent = err.message;
      errorMsg.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = 'Atualizar Senha';
    });
  });
}
