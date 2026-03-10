// ===========================
// VARIABLES GLOBALES
// ===========================
const STORAGE_KEY = 'filedesk_v2';
const LEGACY_STORAGE_KEY = 'uploadedFiles';
const AUTH_STORAGE_KEY = 'filedesk_current_user';
const AUTH_CACHE_KEY = 'filedesk_current_user_cache';
const API_BASE_URL = (window.AppConfig && window.AppConfig.apiBaseUrl) || 'http://localhost:3000';
const LANGUAGE_STORAGE_KEY = 'filedesk_lang';

const I18N = {
    fr: {
        'app.title': 'FileDesk — Plateforme de depot',
        'nav.main': 'Principal',
        'nav.upload': 'Deposer',
        'nav.explorer': 'Explorateur',
        'nav.history': 'Historique',
        'nav.users': 'Utilisateurs',
        'nav.groups': 'Groupes',
        'nav.followUsers': 'Suivi Utilisateurs',
        'sidebar.language': 'Langue',
        'sidebar.logout': 'Se deconnecter',
        'view.history.title': 'Historique',
        'view.users.title': 'Gestion des utilisateurs',
        'view.users.addUser': 'Ajouter utilisateur',
        'view.groups.title': 'Gestion des groupes',
        'view.groups.formTitle': 'Formulaire groupe',
        'view.follow.title': 'Suivi des utilisateurs',
        'label.role.admin': 'Gorevli',
        'label.role.user': 'Utilisateur',
        'action.edit': 'Modifier',
        'action.delete': 'Supprimer',
        'action.open': 'Ouvrir',
        'action.view': 'Voir',
        'action.download': 'Telecharger',
        'action.viewDesk': 'Voir bureau',
        'action.viewMembers': 'Voir membres',
        'desk.parent': 'Dossier parent',
        'desk.folder': 'Dossier',
        'desk.file': 'Fichier'
    },
    tr: {
        'app.title': 'FileDesk — Dosya Yukleme Platformu',
        'nav.main': 'Ana Menu',
        'nav.upload': 'Yukle',
        'nav.explorer': 'Dosya Gezgini',
        'nav.history': 'Gecmis',
        'nav.users': 'Kullanicilar',
        'nav.groups': 'Gruplar',
        'nav.followUsers': 'Kullanici Takibi',
        'sidebar.language': 'Dil',
        'sidebar.logout': 'Cikis Yap',
        'view.history.title': 'Gecmis',
        'view.users.title': 'Kullanici Yonetimi',
        'view.users.addUser': 'Kullanici Ekle',
        'view.groups.title': 'Grup Yonetimi',
        'view.groups.formTitle': 'Grup Formu',
        'view.follow.title': 'Kullanici Takibi',
        'label.role.admin': 'Gorevli',
        'label.role.user': 'Kullanici',
        'action.edit': 'Duzenle',
        'action.delete': 'Sil',
        'action.open': 'Ac',
        'action.view': 'Gor',
        'action.download': 'Indir',
        'action.viewDesk': 'Masaustunu gor',
        'action.viewMembers': 'Uyeleri gor',
        'desk.parent': 'Ust klasor',
        'desk.folder': 'Klasor',
        'desk.file': 'Dosya'
    }
};

function getCurrentLanguage() {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved === 'tr' ? 'tr' : 'fr';
}

function t(key) {
    const lang = getCurrentLanguage();
    return I18N[lang]?.[key] || I18N.fr[key] || key;
}

function applyStaticTranslations() {
    const lang = getCurrentLanguage();
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        el.textContent = t(key);
    });
    document.title = t('app.title');
}

function initLanguageSwitcher() {
    const select = document.getElementById('languageSelect');
    if (!select) return;
    select.value = getCurrentLanguage();
    select.addEventListener('change', () => {
        const next = select.value === 'tr' ? 'tr' : 'fr';
        localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
        window.location.reload();
    });
}

let selectedFiles = [];
let fileSystemData = createDefaultFileSystem();
let currentFolderId = 'root';
let expandedUploadFolderIds = new Set(['root']);
let currentAuthUser = null;
let adminUsers = [];
let adminGroups = [];
let selectedFollowUserId = null;
let selectedFollowDesk = null;
let selectedFollowDeskFolderId = 'root';
let followSelectionMode = 'users';
let selectedFollowGroupId = null;
let followSelectionRequestId = 0;
let deskSyncTimer = null;
let adminGroupFormMemberIds = [];
let adminGroupEditMemberIds = [];

const INLINE_PREVIEW_MIME_PREFIXES = ['image/', 'text/'];
const INLINE_PREVIEW_MIME_EXACT = new Set(['application/pdf', 'application/json']);
const INLINE_PREVIEW_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp']);

function getUserStorageKey(user) {
    return `${STORAGE_KEY}_${String(user?.id || 'guest')}`;
}

function getCurrentUserStorageKey() {
    return getUserStorageKey(currentAuthUser);
}

function isValidDeskData(data) {
    return data && data.nodes && data.nodes.root && data.nodes.root.type === 'folder' && Array.isArray(data.nodes.root.children);
}

function normalizeDeskData(payload) {
    if (!isValidDeskData(payload)) {
        return null;
    }

    const safePayload = { ...payload };
    safePayload.nodes = Object.entries(payload.nodes || {}).reduce((acc, [nodeId, rawNode]) => {
        if (!rawNode || typeof rawNode !== 'object') return acc;
        const node = { ...rawNode, id: String(rawNode.id || nodeId) };
        if (node.type === 'folder') {
            node.children = Array.isArray(node.children) ? node.children.slice() : [];
        }
        acc[node.id] = node;
        return acc;
    }, {});

    if (!safePayload.nodes.root || safePayload.nodes.root.type !== 'folder') {
        return null;
    }

    safePayload.rootId = safePayload.rootId || 'root';
    return safePayload;
}

function scheduleDeskSync() {
    if (!currentAuthUser?.id) {
        return;
    }

    clearTimeout(deskSyncTimer);
    deskSyncTimer = setTimeout(() => {
        persistCurrentUserDesk().catch(() => {});
    }, 350);
}

async function persistCurrentUserDesk() {
    if (!currentAuthUser?.id) return;
    const normalized = normalizeDeskData(fileSystemData);
    if (!normalized) {
        return;
    }

    await apiRequest(`/api/filedesks/${encodeURIComponent(currentAuthUser.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ payload: normalized })
    });
}

function mapRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    if (normalized === 'görevli' || normalized === 'gorevli') {
        return 'admin';
    }
    return normalized === 'admin' ? 'admin' : 'user';
}

function isAdminRole(userOrRole) {
    const roleValue = typeof userOrRole === 'string'
        ? userOrRole
        : userOrRole?.role;
    if (!roleValue) return false;
    return mapRole(roleValue) === 'admin';
}

function getApiHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (currentAuthUser?.id) {
        headers['x-auth-user-id'] = String(currentAuthUser.id);
    }
    return headers;
}

async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: getApiHeaders(),
        ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.message || 'Erreur réseau ou serveur');
    }
    return payload;
}

// ===========================
// INITIALISATION
// ===========================
document.addEventListener('DOMContentLoaded', async () => {
    applyStaticTranslations();
    initLanguageSwitcher();

    const isAuthenticated = await initAuth();
    if (!isAuthenticated) {
        return;
    }

    loadStoredFiles();
    await loadUserDeskFromServer();
    initNavigation();
    initDropZone();
    initFilters();
    initMobileMenu();
    initModals();
    initUploadFolderPicker();
    initAdminViews();
    updateFilesCount();
    populateUploadFolderSelect(currentFolderId);
    updateCurrentFolderHints();

    applyRoleVisibility();

    document.getElementById('browseBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
    document.getElementById('submitBtn').addEventListener('click', handleSubmit);
    document.getElementById('clearFilesBtn').addEventListener('click', clearAllFiles);

    document.getElementById('createFolderBtn').addEventListener('click', openFolderModal);
    document.getElementById('uploadCurrentBtn').addEventListener('click', () => {
        document.getElementById('explorerFileInput').click();
    });
    document.getElementById('explorerFileInput').addEventListener('change', handleExplorerUpload);

    if (isAdminRole(currentAuthUser)) {
        await loadAdminData();
    }
});

async function loadUserDeskFromServer(userId = currentAuthUser?.id) {
    if (!userId || !isValidDeskData(fileSystemData)) {
        loadStoredFiles();
    }

    try {
        const payload = await apiRequest(`/api/filedesks/${encodeURIComponent(userId)}`);
        const serverDesk = normalizeDeskData(payload.desk);
        if (serverDesk) {
            fileSystemData = serverDesk;
            currentFolderId = fileSystemData.currentFolderId || fileSystemData.rootId || 'root';
            if (!fileSystemData.nodes[currentFolderId]) {
                currentFolderId = fileSystemData.rootId || 'root';
            }
        }

        if (!isValidDeskData(fileSystemData)) {
            fileSystemData = createDefaultFileSystem();
            currentFolderId = 'root';
        }
    } catch (error) {
        if (!isValidDeskData(fileSystemData)) {
            fileSystemData = createDefaultFileSystem();
            currentFolderId = 'root';
        }
    }

    // Synchronise la version locale si la base n'avait pas encore ce bureau.
    if (!isValidDeskData(fileSystemData)) {
        return;
    }
    await persistCurrentUserDesk().catch(() => {});
}

async function loadAdminData() {
    try {
        await loadUsersData();
        await loadGroupsData();
        await loadFollowUsers();
    } catch (err) {
        console.error(err);
        showToast('Impossible de charger les données d’administration.', 'error');
    }
}

// ===========================
// NAVIGATION
// ===========================
function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            switchView(view);
            // Close mobile sidebar
            closeMobileSidebar();
        });
    });
}

function applyRoleVisibility() {
    const isAdmin = isAdminRole(currentAuthUser);
    document.querySelectorAll('.admin-only').forEach(item => {
        item.style.display = isAdmin ? 'flex' : 'none';
    });
}

function switchView(view) {
    if (['users', 'groups', 'follow'].includes(view) && !isAdminRole(currentAuthUser)) {
        view = 'upload';
    }

    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    if (view === 'upload') {
        document.getElementById('uploadView').classList.add('active');
        updateCurrentFolderHints();
    } else if (view === 'files') {
        document.getElementById('filesView').classList.add('active');
        displayFiles();
    } else if (view === 'history') {
        document.getElementById('historyView').classList.add('active');
        loadUserHistory();
    } else if (view === 'users') {
        document.getElementById('usersView').classList.add('active');
        loadUsersData();
    } else if (view === 'groups') {
        document.getElementById('groupsView').classList.add('active');
        loadGroupsData();
    } else if (view === 'follow') {
        document.getElementById('followView').classList.add('active');
        resetFollowView();
        loadFollowUsers();
    }
}

// ===========================
// MOBILE MENU
// ===========================
function initMobileMenu() {
    const btn = document.getElementById('hamburgerBtn');
    const overlay = document.getElementById('sidebarOverlay');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        const isOpen = sidebar.classList.contains('open');
        if (isOpen) closeMobileSidebar();
        else openMobileSidebar();
    });

    overlay.addEventListener('click', closeMobileSidebar);
}

function openMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const btn = document.getElementById('hamburgerBtn');
    sidebar.classList.add('open');
    overlay.classList.add('visible');
    btn.classList.add('open');
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const btn = document.getElementById('hamburgerBtn');
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    btn.classList.remove('open');
}

// ===========================
// AUTHENTIFICATION
// ===========================
async function initAuth() {
    const savedId = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!savedId) {
        redirectToLogin();
        return false;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(savedId)}`);
        if (!response.ok) throw new Error('Unauthorized');
        const responseBody = await response.json();
        const user = responseBody.user || responseBody;
        if (user?.role) {
            user.role = mapRole(user.role);
        }
        currentAuthUser = user;
        localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(user));
        hydrateUserUI(user);
        bindLogout();
        return true;
    } catch (error) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(AUTH_CACHE_KEY);
        redirectToLogin();
        return false;
    }
}

function hydrateUserUI(user) {
    const name = (user && user.name && user.name.trim()) || user.username || t('label.role.user');
    const initials = name
        .split(' ')
        .filter(Boolean)
        .map(word => word[0].toUpperCase())
        .slice(0, 2)
        .join('') || 'U';

    const initialsEl = document.getElementById('userInitials');
    const nameEl = document.getElementById('userName');
    const roleEl = document.getElementById('userRole');

    if (initialsEl) initialsEl.textContent = initials;
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = mapRoleLabel(user.role);
}

function bindLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (!logoutBtn) return;
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(AUTH_CACHE_KEY);
        redirectToLogin();
    });
}

function redirectToLogin() {
    window.location.href = 'login.html';
}

// ===========================
// MODALS
// ===========================
function initModals() {
    document.getElementById('modalCloseBtn').addEventListener('click', closeSuccessModal);
    document.getElementById('modalBackdrop').addEventListener('click', closeSuccessModal);

    document.getElementById('folderCancelBtn').addEventListener('click', closeFolderModal);
    document.getElementById('folderModalBackdrop').addEventListener('click', closeFolderModal);
    document.getElementById('folderConfirmBtn').addEventListener('click', confirmCreateFolder);
    document.getElementById('itemInfoCloseBtn').addEventListener('click', closeItemInfoModal);
    document.getElementById('itemInfoModalBackdrop').addEventListener('click', closeItemInfoModal);
    document.getElementById('folderNameInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmCreateFolder();
        if (e.key === 'Escape') closeFolderModal();
    });

    document.getElementById('userEditCancelBtn')?.addEventListener('click', closeUserEditModal);
    document.getElementById('userEditSaveBtn')?.addEventListener('click', handleAdminUserEditSubmit);
    document.getElementById('userEditModalBackdrop')?.addEventListener('click', closeUserEditModal);
    document.getElementById('adminUserEditPassword')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleAdminUserEditSubmit();
        }
    });

    document.getElementById('groupEditCancelBtn')?.addEventListener('click', closeGroupEditModal);
    document.getElementById('groupEditSaveBtn')?.addEventListener('click', handleAdminGroupEditSubmit);
    document.getElementById('groupEditModalBackdrop')?.addEventListener('click', closeGroupEditModal);
    document.getElementById('followPreviewCloseBtn')?.addEventListener('click', closeFollowPreviewModal);
    document.getElementById('followPreviewModalBackdrop')?.addEventListener('click', closeFollowPreviewModal);

    document.getElementById('groupMembersSearch')?.addEventListener('input', () => {
        const search = document.getElementById('groupMembersSearch').value;
        renderGroupMemberInputs(adminGroupFormMemberIds, {
            search,
            containerId: 'groupMembersList',
            countId: 'groupMembersCount'
        });
    });

    document.getElementById('groupEditMembersSearch')?.addEventListener('input', () => {
        const search = document.getElementById('groupEditMembersSearch').value;
        renderGroupMemberInputs(adminGroupEditMemberIds, {
            search,
            containerId: 'groupEditMembersList',
            countId: 'groupEditMembersCount'
        });
    });

    document.getElementById('groupMembersList')?.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button[data-member-action]');
        if (!button) return;
        const userId = Number(button.dataset.userId);
        if (!userId) return;

        if (button.dataset.memberAction === 'add') {
            if (!adminGroupFormMemberIds.includes(userId)) {
                adminGroupFormMemberIds.push(userId);
            }
        } else if (button.dataset.memberAction === 'remove') {
            adminGroupFormMemberIds = adminGroupFormMemberIds.filter(id => id !== userId);
        }

        renderGroupMemberInputs(adminGroupFormMemberIds, {
            containerId: 'groupMembersList',
            countId: 'groupMembersCount',
            search: document.getElementById('groupMembersSearch')?.value || ''
        });
    });

    document.getElementById('groupEditMembersList')?.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button[data-member-action]');
        if (!button) return;
        const userId = Number(button.dataset.userId);
        if (!userId) return;

        if (button.dataset.memberAction === 'add') {
            if (!adminGroupEditMemberIds.includes(userId)) {
                adminGroupEditMemberIds.push(userId);
            }
        } else if (button.dataset.memberAction === 'remove') {
            adminGroupEditMemberIds = adminGroupEditMemberIds.filter(id => id !== userId);
        }

        renderGroupMemberInputs(adminGroupEditMemberIds, {
            containerId: 'groupEditMembersList',
            countId: 'groupEditMembersCount',
            search: document.getElementById('groupEditMembersSearch')?.value || ''
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSuccessModal();
            closeFolderModal();
            closeItemInfoModal();
            closeFollowPreviewModal();
            closeUserEditModal();
            closeGroupEditModal();
        }
    });

    document.getElementById('followClearScopeBtn')?.addEventListener('click', () => {
        showAllFollowUsers();
    });
}

function initAdminViews() {
    const userForm = document.getElementById('adminUserForm');
    if (userForm) {
        userForm.addEventListener('submit', handleAdminUserSubmit);
        document.getElementById('adminUserResetBtn')?.addEventListener('click', resetAdminUserForm);
    }

    const groupForm = document.getElementById('adminGroupForm');
    if (groupForm) {
        groupForm.addEventListener('submit', handleAdminGroupSubmit);
        document.getElementById('adminGroupResetBtn')?.addEventListener('click', resetAdminGroupForm);
    }

    const editUserForm = document.getElementById('adminUserEditForm');
    if (editUserForm) {
        editUserForm.addEventListener('submit', (event) => {
            event.preventDefault();
            handleAdminUserEditSubmit();
        });
    }

    const editGroupForm = document.getElementById('adminGroupEditForm');
    if (editGroupForm) {
        editGroupForm.addEventListener('submit', (event) => {
            event.preventDefault();
            handleAdminGroupEditSubmit();
        });
    }
}

async function loadUsersData() {
    const payload = await apiRequest('/api/users');
    adminUsers = payload.users || [];
    renderUsersTable();
    if (followSelectionMode === 'group' && selectedFollowGroupId) {
        const activeGroup = adminGroups.find(g => String(g.id) === String(selectedFollowGroupId));
        if (activeGroup) {
            openGroupFollow(selectedFollowGroupId);
            return;
        }
        showAllFollowUsers();
    } else {
        renderFollowUsersTable();
    }
    renderGroupMemberInputs(adminGroupFormMemberIds, {
        containerId: 'groupMembersList',
        countId: 'groupMembersCount',
        search: document.getElementById('groupMembersSearch')?.value || ''
    });
}

async function loadGroupsData() {
    const payload = await apiRequest('/api/groups');
    adminGroups = payload.groups || [];
    renderGroupsTable();
    renderFollowGroupsTable();

    if (followSelectionMode === 'group' && selectedFollowGroupId) {
        const group = adminGroups.find(g => String(g.id) === String(selectedFollowGroupId));
        if (group) {
            openGroupFollow(selectedFollowGroupId, false);
            return;
        }
    }

    if (followSelectionMode === 'group') {
        showAllFollowUsers();
    }
}

async function loadFollowUsers() {
    if (!adminUsers.length) {
        await loadUsersData();
    }
    if (!adminUsers.length) {
        const usersTbody = document.getElementById('followUsersBody');
        const usersEmpty = document.getElementById('followUsersEmptyState');
        if (usersTbody) usersTbody.innerHTML = '';
        if (usersEmpty) usersEmpty.classList.add('show');
        const groupsTbody = document.getElementById('followGroupsBody');
        const groupsEmpty = document.getElementById('followGroupsEmptyState');
        if (groupsTbody) groupsTbody.innerHTML = '';
        if (groupsEmpty) groupsEmpty.classList.add('show');
        return;
    }
    if (!adminGroups.length) {
        await loadGroupsData();
    }
    renderFollowUsersTable();
    renderFollowGroupsTable();
}

async function loadUserHistory() {
    const payload = await apiRequest('/api/uploads?limit=200');
    renderHistoryTable(payload.uploads || []);
}

async function loadSelectedUserDesk(userId) {
    const payload = await apiRequest(`/api/uploads?userId=${encodeURIComponent(userId)}&limit=200`);
    renderFollowHistory(payload.uploads || []);
}

async function loadSelectedUserHistoryAndDesk(userId) {
    const [historyPayload, deskPayload] = await Promise.all([
        apiRequest(`/api/uploads?userId=${encodeURIComponent(userId)}&limit=200`),
        apiRequest(`/api/filedesks/${encodeURIComponent(userId)}`)
    ]);

    selectedFollowDesk = normalizeDeskData(deskPayload?.desk) || createDefaultFileSystem();
    renderFollowHistory(historyPayload.uploads || []);
    renderFollowDesk(selectedFollowDesk);
}

function initUploadFolderPicker() {
    const picker = document.getElementById('uploadFolderPicker');
    const button = document.getElementById('uploadFolderPickerBtn');
    const menu = document.getElementById('uploadFolderPickerMenu');
    if (!picker || !button || !menu) return;

    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = picker.classList.contains('open');
        picker.classList.toggle('open', !isOpen);
        button.setAttribute('aria-expanded', String(!isOpen));
    });

    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target)) {
            picker.classList.remove('open');
            button.setAttribute('aria-expanded', 'false');
        }
    });
}

function showSuccessModal(fileCount) {
    const modal = document.getElementById('successModal');
    const msg = document.getElementById('modalMessage');
    msg.textContent = fileCount === 1
        ? 'Votre fichier a été déposé avec succès.'
        : `Vos ${fileCount} fichiers ont été déposés avec succès.`;
    modal.style.display = 'flex';
}

function closeSuccessModal() {
    document.getElementById('successModal').style.display = 'none';
}

function openFolderModal() {
    const modal = document.getElementById('folderModal');
    const input = document.getElementById('folderNameInput');
    input.value = '';
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 60);
}

function closeFolderModal() {
    document.getElementById('folderModal').style.display = 'none';
}

function showItemInfoModal(itemId) {
    const item = fileSystemData.nodes[itemId];
    if (!item) return;

    const titleEl = document.getElementById('itemInfoTitle');
    const bodyEl = document.getElementById('itemInfoBody');
    const modal = document.getElementById('itemInfoModal');
    if (!titleEl || !bodyEl || !modal) return;

    const lines = item.type === 'folder'
        ? [
            ['Type', 'Dossier'],
            ['Nom', item.name],
            ['Date', new Date(item.createdAt).toLocaleDateString('fr-FR')]
        ]
        : [
            ['Type', item.fileType],
            ['Nom', item.name],
            ['Taille', formatFileSize(item.fileSize)],
            ['Déposé par', item.uploaderName || '—'],
            ['Date', `${item.uploadDate} ${item.uploadTime || ''}`.trim()],
            ['Commentaire', item.comment || '—']
        ];

    titleEl.textContent = `Infos ${item.type === 'folder' ? 'dossier' : 'fichier'}`;
    bodyEl.innerHTML = lines.map(([label, value]) => (
        `<div class="item-info-row"><span class="item-info-label">${escapeHtml(label)}</span><span class="item-info-value">${escapeHtml(value)}</span></div>`
    )).join('');
    modal.style.display = 'flex';
}

function closeItemInfoModal() {
    const modal = document.getElementById('itemInfoModal');
    if (modal) modal.style.display = 'none';
}

function closeFollowPreviewModal() {
    const modal = document.getElementById('followPreviewModal');
    const body = document.getElementById('followPreviewBody');
    if (body) body.innerHTML = '';
    if (modal) modal.style.display = 'none';
}

function getFollowDeskFileNode(fileId) {
    const desk = selectedFollowDesk;
    if (!desk?.nodes) return null;
    const node = desk.nodes[fileId];
    if (!node || node.type !== 'file') return null;
    return node;
}

function getInlineFileDataUrl(node) {
    if (!node) return null;
    const possible = [
        node.dataUrl,
        node.inlineDataUrl,
        node.fileDataUrl,
        node.previewDataUrl
    ].filter(value => typeof value === 'string' && value.startsWith('data:'));
    return possible[0] || null;
}

function getNodeMimeType(node) {
    const value = String(node?.mimeType || '').trim().toLowerCase();
    if (value) return value;
    const type = String(node?.fileType || '').toLowerCase();
    if (type === 'pdf') return 'application/pdf';
    if (type === 'image') return 'image/*';
    if (type === 'doc') return 'text/plain';
    return '';
}

function previewFollowDeskFile(fileId) {
    const node = getFollowDeskFileNode(fileId);
    if (!node) return;

    const title = document.getElementById('followPreviewTitle');
    const body = document.getElementById('followPreviewBody');
    const modal = document.getElementById('followPreviewModal');
    if (!title || !body || !modal) return;

    title.textContent = node.name || 'Aperçu du fichier';
    const dataUrl = getInlineFileDataUrl(node);
    const mimeType = getNodeMimeType(node);

    if (dataUrl && mimeType.startsWith('image/')) {
        body.innerHTML = `<img class="follow-preview-image" src="${dataUrl}" alt="${escapeHtml(node.name || 'Aperçu image')}">`;
    } else if (dataUrl && mimeType === 'application/pdf') {
        body.innerHTML = `<iframe class="follow-preview-frame" src="${dataUrl}" title="${escapeHtml(node.name || 'Aperçu PDF')}"></iframe>`;
    } else {
        body.innerHTML = `
            <div class="follow-preview-fallback">
                <p><strong>${escapeHtml(node.name || 'Fichier')}</strong></p>
                <p>Type: ${escapeHtml(node.fileType || 'Inconnu')}</p>
                <p>Taille: ${escapeHtml(formatFileSize(Number(node.fileSize) || 0))}</p>
                <p>Prévisualisation détaillée indisponible pour ce fichier.</p>
            </div>
        `;
    }

    modal.style.display = 'flex';
}

function triggerBrowserDownload(filename, href) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename || 'fichier';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function downloadFollowDeskFile(fileId) {
    const node = getFollowDeskFileNode(fileId);
    if (!node) return;

    const dataUrl = getInlineFileDataUrl(node);
    if (dataUrl) {
        triggerBrowserDownload(node.name || 'fichier', dataUrl);
        return;
    }

    const fallbackContent = [
        `Nom: ${node.name || 'fichier'}`,
        `Type: ${node.fileType || 'inconnu'}`,
        `Taille: ${formatFileSize(Number(node.fileSize) || 0)}`,
        `Date: ${node.uploadDate || '—'} ${node.uploadTime || ''}`.trim()
    ].join('\n');
    const blob = new Blob([fallbackContent], { type: 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(`${node.name || 'fichier'}-infos.txt`, objectUrl);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
}

function renderHistoryTable(uploads) {
    const tbody = document.getElementById('historyTableBody');
    const empty = document.getElementById('historyEmptyState');
    if (!tbody || !empty) return;

    tbody.innerHTML = '';
    if (!uploads.length) {
        empty.classList.add('show');
        return;
    }

    empty.classList.remove('show');
    uploads.forEach(file => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(file.file_name)}</td>
            <td><span class="badge ${getUploadBadgeClass(file.file_type)}">${escapeHtml(file.file_type || 'OTHER')}</span></td>
            <td>${formatFileSize(file.file_size)}</td>
            <td>${escapeHtml(file.folder_path || 'Racine')}</td>
            <td class="cell-muted">${escapeHtml(file.created_at || '')}</td>
        `;
        tbody.appendChild(tr);
    });
}

function getUploadBadgeClass(type) {
    const map = {
        PDF: 'badge-pdf',
        DOC: 'badge-doc',
        Image: 'badge-image',
        Video: 'badge-video',
        Archive: 'badge-archive',
        Spreadsheet: 'badge-spreadsheet',
        Presentation: 'badge-presentation'
    };
    return map[type] || 'badge-other';
}

function renderUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    const empty = document.getElementById('usersEmptyState');
    if (!tbody || !empty) return;

    const isAdmin = isAdminRole(currentAuthUser);

    tbody.innerHTML = '';
    if (!adminUsers.length) {
        empty.classList.add('show');
        return;
    }

    empty.classList.remove('show');
    adminUsers.forEach(user => {
        const groups = (user.groups || []).map(g => (typeof g === 'string' ? g : g.name)).filter(Boolean).join(', ') || '—';
        const actionCell = isAdmin
            ? `<td class="actions-cell">
                    <button class="action-btn" onclick="startUserEdit(${user.id})">${escapeHtml(t('action.edit'))}</button>
                    <button class="action-btn delete" onclick="removeUser(${user.id})">${escapeHtml(t('action.delete'))}</button>
               </td>`
            : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="cell-compact">${escapeHtml(user.username)}</td>
            <td class="cell-compact cell-truncate" title="${escapeHtml(user.name || '—')}">${escapeHtml(user.name || '—')}</td>
            <td class="cell-compact cell-truncate" title="${escapeHtml(user.email || '—')}">${escapeHtml(user.email || '—')}</td>
            <td><span class="badge ${mapRole(user.role) === 'admin' ? 'badge-pdf' : 'badge-other'}">${escapeHtml(mapRoleLabel(user.role))}</span></td>
            <td class="cell-compact cell-truncate" title="${escapeHtml(groups)}">${escapeHtml(groups)}</td>
            ${actionCell}
        `;
        tbody.appendChild(tr);
    });
}

function getTrackableFollowUsers() {
    return adminUsers.filter(user => {
        return String(user.id) !== String(currentAuthUser?.id) && mapRole(user.role) !== 'admin';
    });
}

function renderGroupsTable() {
    const tbody = document.getElementById('groupsTableBody');
    const empty = document.getElementById('groupsEmptyState');
    if (!tbody || !empty) return;

    tbody.innerHTML = '';
    if (!adminGroups.length) {
        empty.classList.add('show');
        return;
    }

    empty.classList.remove('show');
    adminGroups.forEach(group => {
        const members = (group.members || []).length;
        const created = group.created_at ? new Date(group.created_at).toLocaleDateString('fr-FR') : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="cell-compact cell-truncate" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</td>
            <td class="cell-compact">${escapeHtml(created)}</td>
            <td class="cell-compact">${members} membre(s)</td>
            <td class="actions-cell">
                <button class="action-btn" onclick="startGroupEdit(${group.id})">${escapeHtml(t('action.edit'))}</button>
                <button class="action-btn delete" onclick="removeGroup(${group.id})">${escapeHtml(t('action.delete'))}</button>
            </td>
        `;
            tbody.appendChild(tr);
    });
}

function getFollowActiveGroupName() {
    if (!selectedFollowGroupId) {
        return null;
    }

    const group = adminGroups.find(item => String(item.id) === String(selectedFollowGroupId));
    return group ? group.name : null;
}

function getTrackableFollowUsersInGroup(groupId = selectedFollowGroupId) {
    const group = adminGroups.find(item => String(item.id) === String(groupId));
    if (!group) {
        return [];
    }

    const memberIds = new Set((group.members || []).map(member => Number(member?.id || member)).filter(Boolean));
    return getTrackableFollowUsers().filter(user => memberIds.has(Number(user.id)));
}

function renderFollowUsersTable(users = getTrackableFollowUsers()) {
    const tbody = document.getElementById('followUsersBody');
    const usersEmpty = document.getElementById('followUsersEmptyState');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (usersEmpty) usersEmpty.classList.add('show');

    if (!users.length) return;

    if (usersEmpty) usersEmpty.classList.remove('show');

    users.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="cell-truncate" title="${escapeHtml(user.username || '—')}">${escapeHtml(user.username || '—')}</td>
            <td class="cell-truncate" title="${escapeHtml(user.name || '—')}">${escapeHtml(user.name || '—')}</td>
            <td class="actions-cell">
                <button class="action-btn" onclick="openUserFollow(${user.id})">${escapeHtml(t('action.viewDesk'))}</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (followSelectionMode === 'group') {
        const selectedLabel = selectedFollowGroupId
            ? (adminGroups.find(group => String(group.id) === String(selectedFollowGroupId))?.name || `Groupe ${selectedFollowGroupId}`)
            : 'Groupe';
        updateFollowScopeLabel(`Sélection : utilisateurs du groupe ${selectedLabel}`);
    } else {
        updateFollowScopeLabel('Aucun filtre de groupe actif.');
    }
}

function renderFollowGroupsTable() {
    const tbody = document.getElementById('followGroupsBody');
    const empty = document.getElementById('followGroupsEmptyState');
    if (!tbody || !empty) return;

    tbody.innerHTML = '';
    if (!adminGroups.length) {
        empty.classList.add('show');
        return;
    }

    empty.classList.remove('show');
    adminGroups.forEach(group => {
        const tr = document.createElement('tr');
        const members = group.members || [];
        const filteredMembers = Array.isArray(members)
            ? members.filter(member => {
                const role = mapRole(member?.role);
                const memberId = String(member?.id || '');
                return role !== 'admin' && memberId !== String(currentAuthUser?.id);
            })
            : [];

        const memberCount = filteredMembers.length;

        const memberNames = filteredMembers
            .map((member) => {
                if (!member) return null;
                if (typeof member === 'string') return member;
                return member.name || member.username || member.email || String(member.id || '');
            })
            .filter(Boolean);

        const groupLabel = `${group.name} (${memberCount} membre(s))`;

        tr.innerHTML = `
            <td class="cell-truncate" title="${escapeHtml(memberNames.join(', '))}">${escapeHtml(groupLabel)}</td>
            <td class="actions-cell">
                <button class="action-btn" onclick="openGroupFollow(${group.id})">${escapeHtml(t('action.viewMembers'))}</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function resetFollowView() {
    selectedFollowUserId = null;
    selectedFollowDesk = null;
    followSelectionMode = 'users';
    selectedFollowGroupId = null;
    followSelectionRequestId = 0;
    updateFollowScopeLabel('Aucun filtre de groupe actif.');
    const title = document.getElementById('followUserTitle');
    const meta = document.getElementById('followUserMeta');
    if (title) title.textContent = 'Aucun utilisateur sélectionné';
    if (meta) meta.textContent = 'Sélectionnez un utilisateur pour voir son bureau et son historique.';
    renderFollowHistory([]);
    renderFollowDesk(null);
}

async function openUserFollow(userId) {
    const requestId = ++followSelectionRequestId;
    renderFollowHistory([]);
    renderFollowDesk(null);
    selectedFollowUserId = Number(userId);
    const title = document.getElementById('followUserTitle');
    const meta = document.getElementById('followUserMeta');
    if (title) title.textContent = 'Chargement...';
    if (meta) meta.textContent = 'Récupération du détail utilisateur...';

    try {
        const [overviewResult, historyResult, deskResult] = await Promise.all([
            apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/overview`),
            apiRequest(`/api/uploads?userId=${encodeURIComponent(userId)}&limit=200`).catch(error => ({ _error: String(error?.message || '') })),
            apiRequest(`/api/filedesks/${encodeURIComponent(userId)}`).catch(() => null)
        ]);

        if (requestId !== followSelectionRequestId) {
            return;
        }

        const overview = overviewResult || {};
        const user = overview.user;
        if (!user) {
            throw new Error('Utilisateur introuvable');
        }

        const historyPayload = historyResult && !historyResult._error
            ? historyResult
            : { uploads: [] };

        const fallbackDeskData = overview.user?.desk || null;
        const deskPayload = deskResult ? deskResult : { desk: fallbackDeskData };

        if (historyResult && historyResult._error) {
            showToast('L’historique utilisateur n’est pas disponible pour le moment.', 'error');
        }
        if (deskResult === null && !fallbackDeskData) {
            showToast('Le bureau utilisateur n’est pas disponible pour le moment.', 'error');
        }

        const groups = Array.isArray(user.groups)
            ? user.groups.map(group => (typeof group === 'string' ? group : group.name)).filter(Boolean).join(', ') || '—'
            : '—';

        selectedFollowUserId = user.id;
        if (title) title.textContent = `${user.name || user.username} — ${user.email || ''}`;
        if (meta) meta.textContent = `Rôle : ${mapRoleLabel(user.role)} | Dépôts : ${overview.totalUploads || 0} | Groupes : ${groups}`;

        const normalizedDesk = normalizeDeskData(deskPayload?.desk);
        selectedFollowDesk = normalizedDesk || createDefaultFileSystem();
        renderFollowHistory(historyPayload.uploads || []);
        renderFollowDesk(selectedFollowDesk);

        if (followSelectionMode === 'group' && selectedFollowGroupId) {
            const groupLabel = getFollowActiveGroupName() || `Groupe ${selectedFollowGroupId}`;
            updateFollowScopeLabel(`Filtre actif : utilisateurs du groupe ${groupLabel}`);
            setFollowScopeUi(true);
        } else {
            followSelectionMode = 'users';
            selectedFollowGroupId = null;
            updateFollowScopeLabel('Aucun filtre de groupe actif.');
            setFollowScopeUi(false);
        }
    } catch (error) {
        if (requestId !== followSelectionRequestId) {
            return;
        }
        showToast(error.message || 'Erreur de chargement du suivi utilisateur', 'error');
        resetFollowView();
    }
}

function updateFollowScopeLabel(text) {
    const scopeLabel = document.getElementById('followScopeLabel');
    if (scopeLabel) scopeLabel.textContent = text;
}

function setFollowScopeUi(isInGroup) {
    const clearScopeBtn = document.getElementById('followClearScopeBtn');
    if (!clearScopeBtn) return;
    clearScopeBtn.style.display = isInGroup ? 'inline-flex' : 'none';
}

function showAllFollowUsers() {
    followSelectionMode = 'users';
    selectedFollowGroupId = null;
    selectedFollowUserId = null;
    setFollowScopeUi(false);
    renderFollowUsersTable();
    updateFollowScopeLabel('Aucun filtre de groupe actif.');

    const title = document.getElementById('followUserTitle');
    const meta = document.getElementById('followUserMeta');
    if (title) title.textContent = 'Aucun utilisateur sélectionné';
    if (meta) meta.textContent = 'Sélectionnez un utilisateur pour voir son bureau et son historique.';
    renderFollowHistory([]);
    renderFollowDesk(null);
}

function openGroupFollow(groupId, refreshUsers = true) {
    const group = adminGroups.find(item => String(item.id) === String(groupId));
    if (!group) {
        return;
    }

    followSelectionMode = 'group';
    selectedFollowGroupId = Number(group.id);
    selectedFollowUserId = null;
    selectedFollowDesk = null;
    setFollowScopeUi(true);
    const members = getTrackableFollowUsersInGroup(group.id);
    renderFollowUsersTable(members);
    updateFollowScopeLabel(`Filtre actif : utilisateurs du groupe ${group.name}`);
    const title = document.getElementById('followUserTitle');
    const meta = document.getElementById('followUserMeta');
    if (title) title.textContent = `Groupe : ${group.name}`;
    if (meta) meta.textContent = 'Choisissez un membre pour ouvrir son bureau et son historique.';

    renderFollowHistory([]);
    renderFollowDesk(null);

    if (refreshUsers) {
        renderFollowGroupsTable();
    }
}

function renderFollowHistory(files) {
    const tbody = document.getElementById('followHistoryBody');
    const empty = document.getElementById('followEmptyState');
    if (!tbody || !empty) return;

    tbody.innerHTML = '';
    if (!files.length) {
        empty.classList.add('show');
        return;
    }

    empty.classList.remove('show');
    files.forEach(file => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(file.file_name)}</td>
            <td><span class="badge ${getUploadBadgeClass(file.file_type)}">${escapeHtml(file.file_type || 'OTHER')}</span></td>
            <td>${formatFileSize(file.file_size)}</td>
            <td>${escapeHtml(file.folder_path || 'Racine')}</td>
            <td>${escapeHtml(file.created_at || '')}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderFollowDesk(deskData) {
    const tbody = document.getElementById('followDeskBody');
    const empty = document.getElementById('followDeskEmptyState');
    if (!tbody || !empty) return;

    const normalized = normalizeDeskData(deskData);
    if (!normalized) {
        selectedFollowDesk = null;
        selectedFollowDeskFolderId = 'root';
        const breadcrumb = document.getElementById('followDeskBreadcrumb');
        if (breadcrumb) breadcrumb.innerHTML = '';
        empty.classList.add('show');
        tbody.innerHTML = '';
        return;
    }

    selectedFollowDesk = normalized;
    selectedFollowDeskFolderId = normalized.rootId || 'root';
    renderFollowDeskExplorer();
}

function renderFollowDeskExplorer() {
    const tbody = document.getElementById('followDeskBody');
    const empty = document.getElementById('followDeskEmptyState');
    if (!tbody || !empty) return;

    const desk = selectedFollowDesk;
    if (!desk || !desk.nodes) {
        empty.classList.add('show');
        tbody.innerHTML = '';
        return;
    }

    const currentFolder = desk.nodes[selectedFollowDeskFolderId];
    if (!currentFolder || currentFolder.type !== 'folder') {
        selectedFollowDeskFolderId = desk.rootId || 'root';
    }
    const folderNode = desk.nodes[selectedFollowDeskFolderId];
    if (!folderNode || folderNode.type !== 'folder') {
        empty.classList.add('show');
        tbody.innerHTML = '';
        return;
    }

    renderFollowDeskBreadcrumb();

    const items = (folderNode.children || [])
        .map(id => desk.nodes[id])
        .filter(Boolean)
        .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
        });

    tbody.innerHTML = '';
    if (!items.length) {
        empty.classList.add('show');
        return;
    }

    empty.classList.remove('show');
    items.forEach(item => {
        const row = document.createElement('tr');
        if (item.type === 'folder') {
            row.className = 'folder-row';
        }

        const typeLabel = item.type === 'folder' ? t('desk.folder') : (item.fileType || t('desk.file'));
        const badgeClass = item.type === 'folder' ? 'badge-folder' : getBadgeClass(item);
        const size = item.type === 'folder' ? '—' : formatFileSize(Number(item.fileSize) || 0);
        const timestamp = item.type === 'folder'
            ? item.createdAt
            : item.timestamp;
        const dateLabel = timestamp ? new Date(timestamp).toLocaleDateString('fr-FR') : (item.uploadDate || '—');

        const nameCell = item.type === 'folder'
            ? `<button class="folder-btn" onclick="openFollowDeskFolder('${item.id}')">
                    <span class="folder-btn-icon">📁</span>
                    ${escapeHtml(item.name || t('desk.folder'))}
               </button>`
            : `<div class="file-name-cell">
                    <div class="file-icon-sm" style="background:${getFileColor(item.fileType)}">${escapeHtml((item.extension || '?').slice(0, 4))}</div>
                    ${escapeHtml(item.name || t('desk.file'))}
               </div>`;

        const actionsCell = item.type === 'folder'
            ? `<button class="action-btn" onclick="openFollowDeskFolder('${item.id}')">${escapeHtml(t('action.open'))}</button>`
            : `<button class="action-btn" onclick="previewFollowDeskFile('${item.id}')">${escapeHtml(t('action.view'))}</button>
               <button class="action-btn" onclick="downloadFollowDeskFile('${item.id}')">${escapeHtml(t('action.download'))}</button>`;

        row.innerHTML = `
            <td class="cell-name">${nameCell}</td>
            <td><span class="badge ${badgeClass}">${escapeHtml(typeLabel)}</span></td>
            <td>${size}</td>
            <td>${escapeHtml(dateLabel)}</td>
            <td class="actions-cell">${actionsCell}</td>
        `;
        tbody.appendChild(row);
    });
}

function openFollowDeskFolder(folderId) {
    const desk = selectedFollowDesk;
    if (!desk || !desk.nodes) return;
    const folder = desk.nodes[folderId];
    if (!folder || folder.type !== 'folder') {
        return;
    }
    selectedFollowDeskFolderId = folderId;
    renderFollowDeskExplorer();
}

function openFollowDeskParentFolder() {
    const desk = selectedFollowDesk;
    if (!desk || !desk.nodes) return;
    const currentFolder = desk.nodes[selectedFollowDeskFolderId];
    const parentId = currentFolder?.parentId;
    if (!parentId || !desk.nodes[parentId]) {
        selectedFollowDeskFolderId = desk.rootId || 'root';
    } else {
        selectedFollowDeskFolderId = parentId;
    }
    renderFollowDeskExplorer();
}

function renderFollowDeskBreadcrumb() {
    const breadcrumb = document.getElementById('followDeskBreadcrumb');
    const desk = selectedFollowDesk;
    if (!breadcrumb || !desk || !desk.nodes) return;

    const path = [];
    let cursor = desk.nodes[selectedFollowDeskFolderId];
    while (cursor) {
        path.unshift(cursor);
        if (!cursor.parentId) break;
        cursor = desk.nodes[cursor.parentId];
    }

    breadcrumb.innerHTML = '';
    path.forEach((folder, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `follow-breadcrumb-item${index === path.length - 1 ? ' active' : ''}`;
        btn.textContent = folder.name || 'Racine';
        btn.addEventListener('click', () => {
            if (index !== path.length - 1) {
                openFollowDeskFolder(folder.id);
            }
        });
        breadcrumb.appendChild(btn);
        if (index < path.length - 1) {
            const sep = document.createElement('span');
            sep.className = 'follow-breadcrumb-sep';
            sep.textContent = '/';
            breadcrumb.appendChild(sep);
        }
    });
}

function mapRoleLabel(role) {
    return mapRole(role) === 'admin' ? t('label.role.admin') : t('label.role.user');
}

function renderGroupMemberInputs(selectedUserIds = [], options = {}) {
    const {
        search = '',
        containerId = 'groupMembersList',
        countId = 'groupMembersCount'
    } = options;

    const container = document.getElementById(containerId);
    const countElement = document.getElementById(countId);
    if (!container) return;

    const normalizedSearch = search.toLowerCase().trim();
    const selected = new Set(selectedUserIds.map(id => Number(id)).filter(Boolean));
    const users = adminUsers
        .filter(user => mapRole(user.role) !== 'admin')
        .slice()
        .sort((a, b) => {
            const aLabel = String(a.name || a.username || '').toLowerCase();
            const bLabel = String(b.name || b.username || '').toLowerCase();
            return aLabel.localeCompare(bLabel);
        });

    const selectedUsers = users.filter(user => selected.has(Number(user.id)));
    const availableUsers = users.filter(user => {
        if (selected.has(Number(user.id))) return false;
        const label = `${user.name || ''} ${user.username || ''} ${user.email || ''}`.toLowerCase();
        return !normalizedSearch || label.includes(normalizedSearch);
    });

    const selectedMarkup = selectedUsers.length
        ? selectedUsers.map(user => `
            <span class="group-member-chip">
                <span class="group-member-chip-name">${escapeHtml(user.name || user.username)}</span>
                <button type="button" class="group-member-chip-remove" data-member-action="remove" data-user-id="${user.id}" aria-label="Retirer ${escapeHtml(user.name || user.username)}">×</button>
            </span>
        `).join('')
        : '<p class="group-members-empty">Aucun membre sélectionné.</p>';

    const availableMarkup = availableUsers.length
        ? availableUsers.map(user => `
            <button type="button" class="group-member-option" data-member-action="add" data-user-id="${user.id}">
                <span class="group-member-option-main">${escapeHtml(user.name || user.username)}</span>
                <span class="group-member-option-sub">${escapeHtml(user.username)}${user.email ? ` • ${escapeHtml(user.email)}` : ''}</span>
            </button>
        `).join('')
        : '<p class="group-members-empty">Aucun résultat.</p>';

    container.innerHTML = `
        <div class="group-members-selected">${selectedMarkup}</div>
        <div class="group-members-options">${availableMarkup}</div>
    `;

    if (countElement) {
        countElement.textContent = `${selectedUsers.length} membre(s)`;
    }
}

function resetAdminUserForm() {
    const form = document.getElementById('adminUserForm');
    if (!form) return;
    form.reset();
    const idInput = document.getElementById('adminUserId');
    if (idInput) idInput.value = '';
}

function closeUserEditModal() {
    const modal = document.getElementById('userEditModal');
    if (!modal) return;
    const editForm = document.getElementById('adminUserEditForm');
    if (editForm) editForm.reset();
    modal.style.display = 'none';
}

function closeGroupEditModal() {
    const modal = document.getElementById('groupEditModal');
    if (!modal) return;
    const editForm = document.getElementById('adminGroupEditForm');
    const searchInput = document.getElementById('groupEditMembersSearch');
    if (editForm) {
        editForm.reset();
    }
    if (searchInput) {
        searchInput.value = '';
    }
    adminGroupEditMemberIds = [];
    renderGroupMemberInputs(adminGroupEditMemberIds, {
        containerId: 'groupEditMembersList',
        countId: 'groupEditMembersCount'
    });
    modal.style.display = 'none';
}

function resetAdminGroupForm() {
    const form = document.getElementById('adminGroupForm');
    if (!form) return;
    form.reset();
    const idInput = document.getElementById('adminGroupId');
    if (idInput) idInput.value = '';
    adminGroupFormMemberIds = [];
    renderGroupMemberInputs(adminGroupFormMemberIds, {
        containerId: 'groupMembersList',
        countId: 'groupMembersCount',
        search: ''
    });
}

async function handleAdminUserSubmit(e) {
    e.preventDefault();

    const username = document.getElementById('adminUserUsername').value.trim();
    const password = document.getElementById('adminUserPassword').value;
    const name = document.getElementById('adminUserName').value.trim();
    const email = document.getElementById('adminUserEmail').value.trim();
    const role = document.getElementById('adminUserRole').value;

    if (!username) {
        showToast('Identifiant requis', 'error');
        return;
    }

    const payload = { username, name, email: email || null, role };
    if (password) payload.password = password;

    try {
        if (!password) {
            showToast('Mot de passe requis pour la création', 'error');
            return;
        }
        await apiRequest('/api/users', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Utilisateur créé', 'success');
        resetAdminUserForm();
        await loadUsersData();
    } catch (err) {
        showToast(err.message || 'Erreur sauvegarde utilisateur', 'error');
    }
}

async function handleAdminUserEditSubmit() {
    const editForm = document.getElementById('adminUserEditForm');
    const idInput = document.getElementById('adminUserEditId');
    const username = document.getElementById('adminUserEditUsername').value.trim();
    const password = document.getElementById('adminUserEditPassword').value;
    const name = document.getElementById('adminUserEditName').value.trim();
    const email = document.getElementById('adminUserEditEmail').value.trim();
    const role = document.getElementById('adminUserEditRole').value;

    if (!idInput?.value) {
        showToast('Sélectionnez un utilisateur à modifier.', 'error');
        return;
    }
    if (!username) {
        showToast('Identifiant requis', 'error');
        return;
    }
    if (!editForm) {
        return;
    }

    const payload = {
        username,
        name,
        role,
        email: email || null
    };
    if (password) {
        payload.password = password;
    }

    try {
        await apiRequest(`/api/users/${encodeURIComponent(idInput.value)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });
        showToast('Utilisateur modifié', 'success');
        closeUserEditModal();
        await loadUsersData();
    } catch (err) {
        showToast(err.message || 'Erreur modification utilisateur', 'error');
    }
}

async function removeUser(userId) {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    if (String(userId) === String(currentAuthUser?.id)) {
        showToast('Vous ne pouvez pas supprimer votre propre compte.', 'error');
        return;
    }

    try {
        await apiRequest(`/api/users/${userId}`, { method: 'DELETE' });
        await loadUsersData();
        showToast('Utilisateur supprimé', 'info');
    } catch (err) {
        showToast(err.message || 'Erreur suppression utilisateur', 'error');
    }
}

async function startUserEdit(userId) {
    const user = adminUsers.find(u => String(u.id) === String(userId));
    if (!user) return;

    const idInput = document.getElementById('adminUserEditId');
    const username = document.getElementById('adminUserEditUsername');
    const name = document.getElementById('adminUserEditName');
    const email = document.getElementById('adminUserEditEmail');
    const role = document.getElementById('adminUserEditRole');
    const password = document.getElementById('adminUserEditPassword');
    const modal = document.getElementById('userEditModal');
    if (!idInput || !username || !name || !email || !role || !password || !modal) return;

    idInput.value = String(user.id);
    username.value = user.username || '';
    name.value = user.name || '';
    email.value = user.email || '';
    role.value = mapRoleBackend(user.role);
    password.value = '';
    modal.style.display = 'flex';
}

function mapRoleBackend(role) {
    return role === 'admin' ? 'admin' : 'user';
}

async function handleAdminGroupSubmit(e) {
    e.preventDefault();
    const idInput = document.getElementById('adminGroupId');
    const name = document.getElementById('adminGroupName').value.trim();
    const allowedUserIds = new Set(
        adminUsers
            .filter(user => mapRole(user.role) !== 'admin')
            .map(user => Number(user.id))
            .filter(Boolean)
    );
    const checked = adminGroupFormMemberIds.filter(id => allowedUserIds.has(Number(id)));

    if (!name) {
        showToast('Nom de groupe requis', 'error');
        return;
    }

    const payload = { name, userIds: checked };
    try {
        const editing = idInput.value ? Number(idInput.value) : null;
        if (editing) {
            await apiRequest(`/api/groups/${editing}`, { method: 'PATCH', body: JSON.stringify(payload) });
            showToast('Groupe modifié', 'success');
        } else {
            await apiRequest('/api/groups', { method: 'POST', body: JSON.stringify(payload) });
            showToast('Groupe créé', 'success');
        }
        resetAdminGroupForm();
        await loadGroupsData();
        await loadUsersData();
    } catch (err) {
        showToast(err.message || 'Erreur sauvegarde groupe', 'error');
    }
}

async function handleAdminGroupEditSubmit() {
    const idInput = document.getElementById('adminGroupEditId');
    const name = document.getElementById('adminGroupEditName').value.trim();
    const allowedUserIds = new Set(
        adminUsers
            .filter(user => mapRole(user.role) !== 'admin')
            .map(user => Number(user.id))
            .filter(Boolean)
    );
    const checked = adminGroupEditMemberIds.filter(id => allowedUserIds.has(Number(id)));

    if (!idInput?.value) {
        showToast('Sélectionnez un groupe à modifier.', 'error');
        return;
    }
    if (!name) {
        showToast('Nom de groupe requis', 'error');
        return;
    }

    const payload = { name, userIds: checked };
    try {
        await apiRequest(`/api/groups/${encodeURIComponent(idInput.value)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });
        closeGroupEditModal();
        showToast('Groupe modifié', 'success');
        await loadGroupsData();
        await loadUsersData();
    } catch (err) {
        showToast(err.message || 'Erreur modification groupe', 'error');
    }
}

async function removeGroup(groupId) {
    if (!confirm('Supprimer ce groupe ?')) return;
    try {
        await apiRequest(`/api/groups/${groupId}`, { method: 'DELETE' });
        await loadGroupsData();
        await loadUsersData();
        showToast('Groupe supprimé', 'info');
    } catch (err) {
        showToast(err.message || 'Erreur suppression groupe', 'error');
    }
}

async function startGroupEdit(groupId) {
    const group = adminGroups.find(g => String(g.id) === String(groupId));
    if (!group) return;

    const editIdInput = document.getElementById('adminGroupEditId');
    const editNameInput = document.getElementById('adminGroupEditName');
    const modal = document.getElementById('groupEditModal');
    if (!editIdInput || !editNameInput || !modal) return;

    editIdInput.value = String(group.id);
    editNameInput.value = group.name || '';

    const members = (group.members || [])
        .map(member => Number(member.id || member))
        .filter(Boolean)
        .filter(memberId => {
            const user = adminUsers.find(item => Number(item.id) === Number(memberId));
            return user && mapRole(user.role) !== 'admin';
        });
    adminGroupEditMemberIds = Array.from(new Set(members));
    renderGroupMemberInputs(adminGroupEditMemberIds, {
        containerId: 'groupEditMembersList',
        countId: 'groupEditMembersCount',
        search: ''
    });
    modal.style.display = 'flex';
}

function confirmCreateFolder() {
    const input = document.getElementById('folderNameInput');
    const name = input.value.trim();

    if (!name) {
        input.focus();
        showToast('Entrez un nom de dossier', 'error');
        return;
    }

    if (isNameTakenInCurrentFolder(name)) {
        showToast('Un élément avec ce nom existe déjà', 'error');
        input.select();
        return;
    }

    const currentFolder = getCurrentFolder();
    const folderNode = {
        id: generateId(),
        type: 'folder',
        name,
        children: [],
        createdAt: Date.now(),
        parentId: currentFolderId
    };

    fileSystemData.nodes[folderNode.id] = folderNode;
    currentFolder.children.push(folderNode.id);
    saveFiles();
    displayFiles();
    closeFolderModal();
    showToast(`Dossier « ${name} » créé`, 'success');
}

// ===========================
// DRAG & DROP
// ===========================
function initDropZone() {
    const dropZone = document.getElementById('dropZone');
    const idle = document.getElementById('dropIdle');
    const active = document.getElementById('dropActive');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
        document.body.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
    });

    dropZone.addEventListener('dragenter', () => {
        dropZone.classList.add('drag-over');
        idle.style.display = 'none';
        active.style.display = 'flex';
    });

    dropZone.addEventListener('dragleave', (e) => {
        if (!dropZone.contains(e.relatedTarget)) {
            dropZone.classList.remove('drag-over');
            idle.style.display = 'flex';
            active.style.display = 'none';
        }
    });

    dropZone.addEventListener('drop', (e) => {
        dropZone.classList.remove('drag-over');
        idle.style.display = 'flex';
        active.style.display = 'none';
        handleFiles(e.dataTransfer.files);
    });

    dropZone.addEventListener('click', (e) => {
        if (e.target.closest('#browseBtn')) return;
        document.getElementById('fileInput').click();
    });

    dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            document.getElementById('fileInput').click();
        }
    });
}

function handleFileSelect(e) {
    handleFiles(e.target.files);
}

function handleFiles(files) {
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files).filter(f => f.size <= 50 * 1024 * 1024);
    const oversized = Array.from(files).filter(f => f.size > 50 * 1024 * 1024);

    if (oversized.length > 0) {
        showToast(`${oversized.length} fichier(s) ignoré(s) — dépasse 50 MB`, 'error');
    }

    if (newFiles.length === 0) return;

    // Merge and deduplicate by name
    newFiles.forEach(f => {
        if (!selectedFiles.find(sf => sf.name === f.name && sf.size === f.size)) {
            selectedFiles.push(f);
        }
    });

    renderSelectedFiles();
}

// ===========================
// AFFICHAGE DES FICHIERS SÉLECTIONNÉS
// ===========================
function renderSelectedFiles() {
    const preview = document.getElementById('uploadedFilesPreview');
    const list = document.getElementById('filesList');
    const label = document.getElementById('fileCountLabel');

    const n = selectedFiles.length;
    label.textContent = `${n} fichier${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}`;

    list.innerHTML = '';
    selectedFiles.forEach((file, i) => {
        const li = document.createElement('li');
        li.className = 'file-item';
        const ext = getFileExtension(file.name);
        const type = getFileType(ext);
        const color = getFileColor(type);

        li.innerHTML = `
            <div class="file-ext" style="background:${color}">${ext.slice(0,4)}</div>
            <div class="file-item-info">
                <div class="file-item-name">${escapeHtml(file.name)}</div>
                <div class="file-item-meta">${formatFileSize(file.size)} · ${type}</div>
            </div>
            <button class="file-remove" onclick="removeFile(${i})" aria-label="Retirer ${escapeHtml(file.name)}">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                    <path d="M5 5L15 15M5 15L15 5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
                </svg>
            </button>
        `;
        list.appendChild(li);
    });

    preview.style.display = n > 0 ? 'block' : 'none';
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderSelectedFiles();
    if (selectedFiles.length === 0) {
        document.getElementById('fileInput').value = '';
    }
}

function clearAllFiles() {
    selectedFiles = [];
    document.getElementById('fileInput').value = '';
    document.getElementById('uploadedFilesPreview').style.display = 'none';
}

// ===========================
// SOUMISSION
// ===========================
async function handleSubmit() {
    if (selectedFiles.length === 0) {
        showToast('Sélectionnez au moins un fichier', 'error');
        return;
    }

    if (!currentAuthUser) {
        showToast('Session invalide, reconnectez-vous.', 'error');
        redirectToLogin();
        return;
    }

    const name = (currentAuthUser.name || currentAuthUser.username || 'Utilisateur').trim();
    const email = (currentAuthUser.email || '').trim();
    const comment = document.getElementById('uploaderComment').value.trim();
    const targetFolderId = document.getElementById('uploadTargetFolder').value || currentFolderId;
    const targetFolderPath = getFolderPathName(targetFolderId);

    await addFilesToFolder(selectedFiles, { name, email, comment }, targetFolderId);
    recordUploadsToServer(selectedFiles, comment, targetFolderPath);
    showSuccessModal(selectedFiles.length);
    resetUploadForm();
}

function resetUploadForm() {
    document.getElementById('uploaderComment').value = '';
    document.getElementById('fileInput').value = '';
    selectedFiles = [];
    document.getElementById('uploadedFilesPreview').style.display = 'none';
}

async function handleExplorerUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!currentAuthUser) {
        showToast('Session invalide, reconnectez-vous.', 'error');
        e.target.value = '';
        redirectToLogin();
        return;
    }

    const name = (currentAuthUser.name || currentAuthUser.username || '').trim();
    if (!name) {
        showToast('Profil utilisateur invalide.', 'error');
        e.target.value = '';
        return;
    }

    const email = (currentAuthUser.email || '').trim();
    const comment = document.getElementById('uploaderComment').value.trim();
    const targetFolderPath = getFolderPathName(currentFolderId);

    await addFilesToFolder(Array.from(files), { name, email, comment }, currentFolderId);
    showToast(`${files.length} fichier(s) uploadé(s)`, 'success');
    recordUploadsToServer(Array.from(files), comment, targetFolderPath);
    e.target.value = '';
    displayFiles();
}

async function addFilesToCurrentFolder(files, uploader) {
    await addFilesToFolder(files, uploader, currentFolderId);
}

function getFolderPathName(folderId) {
    const path = getFolderPath(folderId);
    return path.length ? path.map(folder => folder.name).join(' / ') : 'Racine';
}

function recordUploadsToServer(files, comment, folderPath) {
    const entries = files.map(file => ({
        fileName: file.name,
        fileSize: file.size || 0,
        fileType: getFileType(getFileExtension(file.name)),
        comment: comment || null,
        folderPath
    }));

    apiRequest('/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ entries })
    }).catch(() => {
        showToast('Dépôt local OK, enregistrement centralisé indisponible.', 'error');
    });
}

async function addFilesToFolder(files, uploader, folderId) {
    const folder = fileSystemData.nodes[folderId];
    if (!folder || folder.type !== 'folder') return;

    const now = new Date();
    for (const file of files) {
        const ext = getFileExtension(file.name);
        const inlinePreview = await readFileForInlinePreview(file, ext);
        const node = {
            id: generateId(),
            type: 'file',
            name: file.name,
            extension: ext,
            fileType: getFileType(ext),
            fileSize: file.size,
            mimeType: file.type || null,
            dataUrl: inlinePreview,
            uploaderName: uploader.name,
            uploaderEmail: uploader.email || '',
            comment: uploader.comment || '',
            uploadDate: now.toLocaleDateString('fr-FR'),
            uploadTime: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: now.getTime(),
            parentId: folderId
        };
        fileSystemData.nodes[node.id] = node;
        folder.children.push(node.id);
    }

    saveFiles();
    updateFilesCount();
}

function shouldStoreInlinePreview(file, extension) {
    if (!file || !Number.isFinite(file.size) || file.size <= 0) return false;
    if (file.size > 8 * 1024 * 1024) return false;
    const mimeType = String(file.type || '').toLowerCase();
    const ext = String(extension || '').toLowerCase();
    if (INLINE_PREVIEW_MIME_EXACT.has(mimeType)) return true;
    if (INLINE_PREVIEW_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))) return true;
    return INLINE_PREVIEW_EXTENSIONS.has(ext);
}

async function readFileForInlinePreview(file, extension) {
    if (!shouldStoreInlinePreview(file, extension)) {
        return null;
    }
    try {
        return await readFileAsDataUrl(file);
    } catch (error) {
        return null;
    }
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Lecture fichier impossible'));
        reader.readAsDataURL(file);
    });
}

// ===========================
// EXPLORATEUR
// ===========================
function displayFiles() {
    populateUploadFolderSelect();
    renderBreadcrumb();
    applyFilters();
    updateCurrentFolderHints();
}

function renderBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    const path = getFolderPath(currentFolderId);
    bc.innerHTML = '';

    path.forEach((folder, i) => {
        const btn = document.createElement('button');
        btn.className = 'breadcrumb-item' + (i === path.length - 1 ? ' active' : '');
        btn.textContent = folder.name;
        btn.addEventListener('click', () => {
            if (i < path.length - 1) {
                currentFolderId = folder.id;
                displayFiles();
            }
        });
        bc.appendChild(btn);

        if (i < path.length - 1) {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-separator';
            sep.textContent = '/';
            bc.appendChild(sep);
        }
    });
}

function getFolderPath(folderId) {
    const path = [];
    let cursor = fileSystemData.nodes[folderId];
    while (cursor) {
        path.unshift({ id: cursor.id, name: cursor.name });
        if (!cursor.parentId) break;
        cursor = fileSystemData.nodes[cursor.parentId];
    }
    return path;
}

function updateCurrentFolderHints() {
    const selectedFolderId = document.getElementById('uploadTargetFolder')?.value || currentFolderId;
    const path = getFolderPath(selectedFolderId);
    const pathText = (path.length ? path : getFolderPath(fileSystemData.rootId || 'root'))
        .map(p => p.name)
        .join(' / ');
    const el = document.getElementById('currentUploadFolder');
    if (el) el.innerHTML = `Dossier cible : <strong>${pathText}</strong>`;
}

function openFolder(folderId) {
    const folder = fileSystemData.nodes[folderId];
    if (!folder || folder.type !== 'folder') return;
    currentFolderId = folderId;
    displayFiles();
    updateCurrentFolderHints();
}

function renameItem(itemId) {
    const item = fileSystemData.nodes[itemId];
    if (!item) return;

    const newName = prompt('Nouveau nom :', item.name);
    if (!newName || !newName.trim() || newName.trim() === item.name) return;

    const trimmed = newName.trim();
    if (isNameTaken(trimmed, item.parentId, itemId)) {
        showToast('Un élément avec ce nom existe déjà', 'error');
        return;
    }

    item.name = trimmed;
    if (item.type === 'file') {
        item.extension = getFileExtension(trimmed);
        item.fileType = getFileType(item.extension);
    }

    saveFiles();
    displayFiles();
    showToast('Renommé avec succès', 'success');
}

function deleteItem(itemId) {
    const item = fileSystemData.nodes[itemId];
    if (!item) return;

    const label = item.type === 'folder' ? 'ce dossier et tout son contenu' : 'ce fichier';
    if (!confirm(`Supprimer ${label} ?`)) return;

    removeNodeRecursively(itemId);
    saveFiles();
    displayFiles();
    updateFilesCount();
    showToast('Élément supprimé', 'info');
}

function removeNodeRecursively(itemId) {
    const item = fileSystemData.nodes[itemId];
    if (!item) return;

    if (item.type === 'folder') {
        [...item.children].forEach(childId => removeNodeRecursively(childId));
    }

    const parent = fileSystemData.nodes[item.parentId];
    if (parent && Array.isArray(parent.children)) {
        parent.children = parent.children.filter(id => id !== itemId);
    }

    delete fileSystemData.nodes[itemId];

    if (currentFolderId === itemId) {
        currentFolderId = parent ? parent.id : 'root';
    }
}

function viewFileDetails(fileId) {
    const file = fileSystemData.nodes[fileId];
    if (!file || file.type !== 'file') return;

    alert(
        `📄 ${file.name}\n\n` +
        `Type : ${file.fileType}\n` +
        `Taille : ${formatFileSize(file.fileSize)}\n` +
        `Déposé par : ${file.uploaderName}\n` +
        (file.uploaderEmail ? `Email : ${file.uploaderEmail}\n` : '') +
        `Date : ${file.uploadDate} à ${file.uploadTime}\n` +
        (file.comment ? `\nCommentaire :\n${file.comment}` : '')
    );
}

function createItemRow(item) {
    const tr = document.createElement('tr');
    const isFolder = item.type === 'folder';
    if (isFolder) tr.classList.add('folder-row');

    const ext = isFolder ? '' : item.extension || '?';
    const color = isFolder ? '' : getFileColor(item.fileType);
    const badgeClass = getBadgeClass(item);
    const badgeLabel = isFolder ? 'Dossier' : item.fileType;

    const nameCell = isFolder
        ? `<button class="folder-btn" onclick="openFolder('${item.id}')">
               <span class="folder-btn-icon">📁</span>
               ${escapeHtml(item.name)}
               <span class="folder-chip">Dossier</span>
           </button>`
        : `<div class="file-name-cell">
               <div class="file-icon-sm" style="background:${color}">${escapeHtml(ext.slice(0,4))}</div>
               ${escapeHtml(item.name)}
           </div>`;

    const size = isFolder ? '—' : formatFileSize(item.fileSize);
    const user = isFolder ? '—' : escapeHtml(item.uploaderName);
    const date = isFolder
        ? new Date(item.createdAt).toLocaleDateString('fr-FR')
        : `${item.uploadDate}`;

    tr.innerHTML = `
        <td data-label="Nom" class="cell-name">${nameCell}</td>
        <td data-label="Type"><span class="badge ${badgeClass}">${badgeLabel}</span></td>
        <td data-label="Taille" class="cell-muted">${size}</td>
        <td data-label="Déposé par">${user}</td>
        <td data-label="Date" class="cell-muted">${date}</td>
        <td data-label="Actions" class="actions-cell">
            <button class="action-btn mobile-info-btn" onclick="showItemInfoModal('${item.id}')">Infos</button>
            ${isFolder
                ? `<button class="action-btn" onclick="openFolder('${item.id}')">Ouvrir</button>`
                : `<button class="action-btn" onclick="viewFileDetails('${item.id}')">Détails</button>`
            }
            <button class="action-btn" onclick="renameItem('${item.id}')">Renommer</button>
            <button class="action-btn delete" onclick="deleteItem('${item.id}')">Supprimer</button>
        </td>
    `;
    return tr;
}

function getBadgeClass(item) {
    if (item.type === 'folder') return 'badge-folder';
    const t = (item.fileType || '').toLowerCase();
    const map = {
        'pdf': 'badge-pdf',
        'doc': 'badge-doc',
        'image': 'badge-image',
        'video': 'badge-video',
        'archive': 'badge-archive',
        'spreadsheet': 'badge-spreadsheet',
        'presentation': 'badge-presentation'
    };
    return map[t] || 'badge-other';
}

// ===========================
// FILTRES
// ===========================
function initFilters() {
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('filterType').addEventListener('change', applyFilters);
    document.getElementById('filterSort').addEventListener('change', applyFilters);
}

function applyFilters() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const type = document.getElementById('filterType').value;
    const sort = document.getElementById('filterSort').value;

    const folder = getCurrentFolder();
    if (!folder || !Array.isArray(folder.children)) return;

    let items = folder.children.map(id => fileSystemData.nodes[id]).filter(Boolean);

    if (search) {
        items = items.filter(item => {
            const uploaderName = item.type === 'file' ? item.uploaderName || '' : '';
            return item.name.toLowerCase().includes(search) || uploaderName.toLowerCase().includes(search);
        });
    }

    if (type !== 'all') {
        items = items.filter(item => {
            if (type === 'folder') return item.type === 'folder';
            if (item.type !== 'file') return false;
            const t = item.fileType.toLowerCase();
            if (type === 'pdf') return t === 'pdf';
            if (type === 'doc') return t === 'doc';
            if (type === 'image') return t === 'image';
            if (type === 'video') return t === 'video';
            if (type === 'other') return ['other', 'archive', 'spreadsheet', 'presentation'].includes(t);
            return true;
        });
    }

    items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;

        if (sort === 'name') {
            return a.name.localeCompare(b.name, 'fr');
        }
        const tA = a.type === 'folder' ? a.createdAt : a.timestamp;
        const tB = b.type === 'folder' ? b.createdAt : b.timestamp;
        if (sort === 'recent') return tB - tA;
        if (sort === 'oldest') return tA - tB;
        if (sort === 'size') {
            if (a.type === 'folder') return -1;
            if (b.type === 'folder') return 1;
            return b.fileSize - a.fileSize;
        }
        return 0;
    });

    const tbody = document.getElementById('filesTableBody');
    const empty = document.getElementById('emptyState');

    tbody.innerHTML = '';

    if (items.length === 0) {
        empty.classList.add('show');
    } else {
        empty.classList.remove('show');
        items.forEach(item => tbody.appendChild(createItemRow(item)));
    }
}

function populateUploadFolderSelect(preferredFolderId = null) {
    const hiddenInput = document.getElementById('uploadTargetFolder');
    const label = document.getElementById('uploadFolderPickerLabel');
    const tree = document.getElementById('uploadFolderTree');
    if (!hiddenInput || !label || !tree) return;

    const rootId = fileSystemData.rootId || 'root';
    const currentValue = preferredFolderId || hiddenInput.value || currentFolderId || rootId;
    const selectedFolder = fileSystemData.nodes[currentValue]?.type === 'folder' ? currentValue : rootId;

    hiddenInput.value = selectedFolder;
    ensureUploadTreePathExpanded(selectedFolder);

    const path = getFolderPath(selectedFolder).map(folder => folder.name).join(' / ');
    label.textContent = path || 'Racine';

    tree.innerHTML = '';
    renderUploadFolderTreeNode(rootId, 0, selectedFolder, tree);
}

function renderUploadFolderTreeNode(folderId, level, selectedFolderId, container) {
    const folder = fileSystemData.nodes[folderId];
    if (!folder || folder.type !== 'folder') return;

    const children = getFolderChildrenSorted(folderId);
    const hasChildren = children.length > 0;
    const isExpanded = expandedUploadFolderIds.has(folderId);
    const isSelected = folderId === selectedFolderId;

    const row = document.createElement('div');
    row.className = `folder-tree-row${isSelected ? ' selected' : ''}`;
    row.style.setProperty('--level', String(level));

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `folder-tree-toggle${hasChildren ? '' : ' empty'}${isExpanded ? ' expanded' : ''}`;
    toggle.setAttribute('aria-label', hasChildren ? 'Déplier/Replier le dossier' : 'Aucun sous-dossier');
    toggle.innerHTML = hasChildren ? '▶' : '';
    toggle.disabled = !hasChildren;
    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!hasChildren) return;
        if (expandedUploadFolderIds.has(folderId)) {
            expandedUploadFolderIds.delete(folderId);
        } else {
            expandedUploadFolderIds.add(folderId);
        }
        populateUploadFolderSelect(selectedFolderId);
    });

    const itemButton = document.createElement('button');
    itemButton.type = 'button';
    itemButton.className = 'folder-tree-item';
    itemButton.innerHTML = `<span class="folder-tree-icon">📁</span><span class="folder-tree-name">${escapeHtml(folder.name)}</span>`;
    itemButton.addEventListener('click', () => {
        const hiddenInput = document.getElementById('uploadTargetFolder');
        const picker = document.getElementById('uploadFolderPicker');
        const pickerButton = document.getElementById('uploadFolderPickerBtn');
        if (!hiddenInput) return;
        hiddenInput.value = folderId;
        ensureUploadTreePathExpanded(folderId);
        populateUploadFolderSelect(folderId);
        updateCurrentFolderHints();
        if (picker && pickerButton) {
            picker.classList.remove('open');
            pickerButton.setAttribute('aria-expanded', 'false');
        }
    });

    row.appendChild(toggle);
    row.appendChild(itemButton);
    container.appendChild(row);

    if (!hasChildren || !isExpanded) return;

    children.forEach(child => {
        renderUploadFolderTreeNode(child.id, level + 1, selectedFolderId, container);
    });
}

function getFolderChildrenSorted(folderId) {
    const folder = fileSystemData.nodes[folderId];
    if (!folder || folder.type !== 'folder') return [];

    return (folder.children || [])
        .map(id => fileSystemData.nodes[id])
        .filter(node => node && node.type === 'folder')
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

function ensureUploadTreePathExpanded(folderId) {
    const path = getFolderPath(folderId);
    path.forEach(folder => expandedUploadFolderIds.add(folder.id));
}

// ===========================
// TOAST NOTIFICATIONS
// ===========================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-dot"></span>${escapeHtml(message)}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 280);
    }, 3200);
}

// ===========================
// UTILITAIRES
// ===========================
function getCurrentFolder() {
    return fileSystemData.nodes[currentFolderId];
}

function isNameTakenInCurrentFolder(name) {
    return isNameTaken(name, currentFolderId);
}

function isNameTaken(name, parentId, excludedId = null) {
    const parent = fileSystemData.nodes[parentId];
    if (!parent || !Array.isArray(parent.children)) return false;
    return parent.children.some(childId => {
        if (excludedId && childId === excludedId) return false;
        const child = fileSystemData.nodes[childId];
        return child && child.name.toLowerCase() === name.toLowerCase();
    });
}

function getFileExtension(filename) {
    const parts = filename.split('.');
    return parts.length < 2 ? 'FILE' : parts.pop().toUpperCase();
}

function getFileType(extension) {
    const ext = extension.toLowerCase();
    if (ext === 'pdf') return 'PDF';
    if (['doc', 'docx', 'txt', 'odt', 'rtf'].includes(ext)) return 'DOC';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'avif', 'bmp'].includes(ext)) return 'Image';
    if (['mp4', 'avi', 'mov', 'wmv', 'mkv', 'webm'].includes(ext)) return 'Video';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'Archive';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'Spreadsheet';
    if (['ppt', 'pptx', 'odp'].includes(ext)) return 'Presentation';
    return 'Other';
}

function getFileColor(fileType) {
    const map = {
        'PDF':          '#DC2626',
        'DOC':          '#2563EB',
        'Image':        '#059669',
        'Video':        '#7C3AED',
        'Archive':      '#0D9488',
        'Spreadsheet':  '#16A34A',
        'Presentation': '#DB2777',
        'Other':        '#6B7A99'
    };
    return map[fileType] || map.Other;
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0) + ' ' + sizes[i];
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ===========================
// STOCKAGE LOCAL
// ===========================
function createDefaultFileSystem() {
    return {
        rootId: 'root',
        nodes: {
            root: {
                id: 'root',
                type: 'folder',
                name: 'Racine',
                children: [],
                createdAt: Date.now(),
                parentId: null
            }
        }
    };
}

function saveFiles() {
    localStorage.setItem(getCurrentUserStorageKey(), JSON.stringify(fileSystemData));
    scheduleDeskSync();
}

function loadStoredFiles() {
    const stored = localStorage.getItem(getCurrentUserStorageKey());
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (parsed?.nodes?.root) {
                fileSystemData = parsed;
                if (!fileSystemData.nodes[currentFolderId]) {
                    currentFolderId = fileSystemData.rootId || 'root';
                }
                return;
            }
        } catch (err) {
            console.error('Erreur lecture stockage :', err);
        }
    }

    // Migration ancien format
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
        try {
            migrateLegacyData(JSON.parse(legacy));
            saveFiles();
            localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch (err) {
            console.error('Erreur migration :', err);
        }
    }
}

function migrateLegacyData(legacyFiles) {
    fileSystemData = createDefaultFileSystem();
    if (!Array.isArray(legacyFiles)) return;

    legacyFiles.forEach(file => {
        const fileId = file.id || generateId();
        const ext = file.extension || getFileExtension(file.fileName || 'fichier');
        fileSystemData.nodes[fileId] = {
            id: fileId,
            type: 'file',
            name: file.fileName || `fichier-${fileId}`,
            extension: ext,
            fileType: file.fileType || getFileType(ext),
            fileSize: file.fileSize || 0,
            uploaderName: file.uploaderName || 'Inconnu',
            uploaderEmail: file.uploaderEmail || '',
            comment: file.comment || '',
            uploadDate: file.uploadDate || new Date().toLocaleDateString('fr-FR'),
            uploadTime: file.uploadTime || '00:00',
            timestamp: file.timestamp || Date.now(),
            parentId: 'root'
        };
        fileSystemData.nodes.root.children.push(fileId);
    });
}

function updateFilesCount() {
    return Object.values(fileSystemData.nodes).filter(n => n.type === 'file').length;
}

// ===========================
// EXPOSE GLOBAUX (inline handlers)
// ===========================
window.removeFile = removeFile;
window.openFolder = openFolder;
window.renameItem = renameItem;
window.deleteItem = deleteItem;
window.viewFileDetails = viewFileDetails;
window.showItemInfoModal = showItemInfoModal;
window.startUserEdit = startUserEdit;
window.removeUser = removeUser;
window.startGroupEdit = startGroupEdit;
window.removeGroup = removeGroup;
window.openUserFollow = openUserFollow;
window.openFollowDeskFolder = openFollowDeskFolder;
window.openFollowDeskParentFolder = openFollowDeskParentFolder;
window.previewFollowDeskFile = previewFollowDeskFile;
window.downloadFollowDeskFile = downloadFollowDeskFile;
